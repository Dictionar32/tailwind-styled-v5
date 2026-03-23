/**
 * Scanner — Rust native bridge
 *
 * Wraps the Rust scan_workspace and extract_classes_from_source functions.
 * Falls back to the JS implementation when the .node binary is unavailable.
 */
import { createRequire } from "node:module"
import path from "node:path"

interface NativeScannerBinding {
  scanWorkspace?: (
    root: string,
    extensions: string[] | null
  ) => {
    files: Array<{ file: string; classes: string[]; hash: string }>
    totalFiles: number
    uniqueClasses: string[]
  } | null
  extractClassesFromSource?: (source: string) => string[] | null
  hashFileContent?: (content: string) => string | null
  cacheRead?: (cachePath: string) => {
    entries: Array<{
      file: string
      classes: string[]
      hash: string
      mtimeMs: number
      size: number
      hitCount: number
    }>
    version: number
  } | null
  cacheWrite?: (
    cachePath: string,
    entries: Array<{
      file: string
      classes: string[]
      hash: string
      mtimeMs: number
      size: number
      hitCount: number
    }>
  ) => boolean
  cachePriority?: (
    mtimeMs: number,
    size: number,
    cachedMtimeMs: number,
    cachedSize: number,
    cachedHitCount: number,
    cachedLastSeenMs: number,
    nowMs: number
  ) => number
}

let _binding: NativeScannerBinding | null | undefined

function getBinding(): NativeScannerBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    _binding = null
    return null
  }

  const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd()
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(runtimeDir, "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]

  const req =
    typeof require === "function" ? require : createRequire(path.join(runtimeDir, "noop.cjs"))

  for (const c of candidates) {
    try {
      const mod = req(c) as NativeScannerBinding
      if (
        mod?.scanWorkspace ||
        mod?.extractClassesFromSource ||
        mod?.hashFileContent ||
        mod?.cacheRead ||
        mod?.cacheWrite
      ) {
        _binding = mod
        return _binding
      }
    } catch {
      /* try next */
    }
  }

  _binding = null
  return null
}

export function scanWorkspaceNative(
  root: string,
  extensions?: string[]
): ReturnType<NonNullable<NativeScannerBinding["scanWorkspace"]>> | null {
  return getBinding()?.scanWorkspace?.(root, extensions ?? null) ?? null
}

export function extractClassesNative(source: string): string[] | null {
  return getBinding()?.extractClassesFromSource?.(source) ?? null
}

export function hashContentNative(content: string): string | null {
  return getBinding()?.hashFileContent?.(content) ?? null
}

export function hasNativeScannerBinding(): boolean {
  return getBinding() !== null
}

export function cacheReadNative(
  cachePath: string
): ReturnType<NonNullable<NativeScannerBinding["cacheRead"]>> | null {
  return getBinding()?.cacheRead?.(cachePath) ?? null
}

export function cacheWriteNative(
  cachePath: string,
  entries: Parameters<NonNullable<NativeScannerBinding["cacheWrite"]>>[1]
): boolean {
  return getBinding()?.cacheWrite?.(cachePath, entries) ?? false
}

export function cachePriorityNative(
  mtimeMs: number,
  size: number,
  cachedMtimeMs: number,
  cachedSize: number,
  cachedHitCount: number,
  cachedLastSeenMs: number,
  nowMs = Date.now()
): number | null {
  return (
    getBinding()?.cachePriority?.(
      mtimeMs,
      size,
      cachedMtimeMs,
      cachedSize,
      cachedHitCount,
      cachedLastSeenMs,
      nowMs
    ) ?? null
  )
}
