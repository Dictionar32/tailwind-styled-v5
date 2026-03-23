/**
 * tailwind-styled-v4 — NativeBridge
 *
 * Loads the native Rust engine (.node binding via index.mjs) and exposes
 * its functions to the JS compiler pipeline.
 *
 * The bridge is loaded lazily and cached. If the .node binary is not
 * present (e.g. the user hasn't built the Rust crate yet), every function
 * returns null and the pipeline falls through to the JS implementation.
 *
 * Environment flags:
 *   TWS_NO_NATIVE=1  — disable native bridge entirely
 *   TWS_NO_RUST=1    — alias for TWS_NO_NATIVE
 */

import { createRequire } from "node:module"
import path from "node:path"

import { createLogger } from "@tailwind-styled/shared"
import type { TransformResult } from "./astTransform"

// ── Types returned by the Rust engine ────────────────────────────────────────

/** Raw shape returned by Rust transform_source — napi auto-converts snake_case → camelCase */
export interface NativeTransformResult {
  code: string
  classes: string[]
  changed: boolean
  /** JSON string: { isServer: boolean, needsClientDirective: boolean } */
  rscJson?: string | null
  /** JSON string: ComponentMetadata[] */
  metadataJson?: string | null
}

/** Parsed from rscJson */
export interface NativeRscResult {
  isServer: boolean
  needsClientDirective: boolean
}

/** Metadata for one compound component, produced by Rust and consumed by @tailwind-styled/runtime */
export interface ComponentMetadata {
  component: string
  tag: string
  baseClass: string
  subComponents: Record<string, { tag: string; class: string }>
}

/** Full bridge interface — all members optional so feature detection is easy */
export interface NativeBridge {
  /** Parse individual class tokens. Throws if binding is unavailable. */
  parseClassesNative?: (input: string) => Array<{
    raw: string
    base: string
    variants: string[]
    modifierType?: string | null
    modifierValue?: string | null
  }>
  /** Fast pre-check — returns null if binding unavailable. */
  hasTwUsageNative?: (source: string) => boolean | null
  /** Idempotency guard — returns null if binding unavailable. */
  isAlreadyTransformedNative?: (source: string) => boolean | null
  /** RSC analysis — returns null if binding unavailable. */
  analyzeRscNative?: (
    source: string,
    filename?: string
  ) => { isServer: boolean; needsClientDirective: boolean; clientReasons: string[] } | null
  /** Full transform — returns null if binding unavailable (JS pipeline takes over). */
  transformSourceNative?: (
    source: string,
    opts: Record<string, unknown>
  ) => NativeTransformResult | null
  /** AST-based class extraction (Oxc+regex hybrid) */
  astExtractClassesNative?: (
    source: string,
    filename?: string
  ) => { classes: string[]; engine: string } | null
  /** Rust-based class extraction via regex */
  extractClassesFromSourceNative?: (source: string) => string[] | null
  /** Analyze class frequency - used for DSE */
  analyzeClassesNative?: (
    filesJson: string,
    root: string,
    topN: number
  ) => {
    root: string
    totalFiles: number
    uniqueClassCount: number
    totalClassOccurrences: number
    topClasses: Array<{ name: string; count: number }>
    duplicateCandidates: Array<{ name: string; count: number }>
    safelist: string[]
  } | null
}

// ── Bridge loader ─────────────────────────────────────────────────────────────

const runtimeDir = typeof __dirname === "string" && __dirname.length > 0 ? __dirname : process.cwd()
const requireFromRuntime =
  typeof module !== "undefined" && typeof module.require === "function"
    ? module.require.bind(module)
    : createRequire(path.join(runtimeDir, "noop.cjs"))

let cachedBridge: NativeBridge | null | undefined
const log = createLogger("compiler:native")

function tryRequire(id: string): NativeBridge | null {
  try {
    const mod = requireFromRuntime(id) as NativeBridge
    return mod ?? null
  } catch (error) {
    log.debug(
      `native bridge load miss ${id}: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

/**
 * Get the native bridge - THROWS if unavailable.
 *
 * v5 CHANGE: Previously returned null and fell back to JS pipeline.
 * Now throws an error to ensure native binding is always used.
 *
 * @throws Error if native binding is not available
 */
export function getNativeBridge(): NativeBridge {
  if (cachedBridge !== undefined) {
    if (cachedBridge === null) {
      throw new Error(
        `[tailwind-styled/compiler v5] Native binding is required but not available.\n` +
          `Please ensure:\n` +
          `  1. The native module is properly installed\n` +
          `  2. You have run: npm run build:native (or use prebuilt binary)\n` +
          `  3. TWS_NO_NATIVE environment variable is not set\n` +
          `\n` +
          `For help, see: https://tailwind-styled.dev/docs/install`
      )
    }
    return cachedBridge
  }

  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    cachedBridge = null
    throw new Error(
      `[tailwind-styled/compiler v5] Native binding is required.\n` +
        `The TWS_NO_NATIVE or TWS_NO_RUST environment variable is set, which disables native binding.\n` +
        `Please unset this environment variable to use the native compiler.`
    )
  }

  const candidates = [
    "@tailwind-styled/native",
    path.resolve(process.cwd(), "native", "index.mjs"),
    path.resolve(runtimeDir, "..", "..", "..", "native", "index.mjs"),
    path.resolve(runtimeDir, "..", "..", "..", "..", "native", "index.mjs"),
  ]

  for (const candidate of candidates) {
    const bridge = tryRequire(candidate)
    if (bridge) {
      log.debug(`native bridge loaded from ${candidate}`)
      cachedBridge = bridge
      return cachedBridge
    }
  }

  // v5: Throw error instead of returning null
  cachedBridge = null
  throw new Error(
    `[tailwind-styled/compiler v5] Native binding not found.\n` +
      `Tried loading from:\n` +
      candidates.map((c) => `  - ${c}`).join("\n") +
      `\n` +
      `\n` +
      `Please build the native module:\n` +
      `  npm run build:native\n` +
      `\n` +
      `Or install a prebuilt binary for your platform.`
  )
}

export function resetNativeBridgeCache(): void {
  cachedBridge = undefined
}

// ── Result adapter ────────────────────────────────────────────────────────────
// Converts the raw Rust NativeTransformResult into the canonical TransformResult
// shape the rest of the JS pipeline expects, parsing JSON fields as needed.

export function adaptNativeResult(raw: NativeTransformResult): TransformResult & {
  metadata?: ComponentMetadata[]
} {
  // Parse rscJson → rsc object
  let rsc: TransformResult["rsc"] | undefined
  if (raw.rscJson) {
    try {
      const parsed = JSON.parse(raw.rscJson) as NativeRscResult
      rsc = {
        isServer: parsed.isServer,
        needsClientDirective: parsed.needsClientDirective,
        clientReasons: [],
      }
    } catch {
      // ignore malformed JSON
    }
  }

  // Parse metadataJson → ComponentMetadata[]
  let metadata: ComponentMetadata[] | undefined
  if (raw.metadataJson) {
    try {
      metadata = JSON.parse(raw.metadataJson) as ComponentMetadata[]
    } catch {
      // ignore malformed JSON
    }
  }

  return {
    code: raw.code,
    classes: raw.classes,
    changed: raw.changed,
    rsc,
    metadata,
  }
}
