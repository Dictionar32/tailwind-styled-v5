/**
 * tailwind-styled-v4 — Plugin System
 *
 * Fondasi ecosystem library. Plugin bisa extend compiler pipeline
 * di berbagai tahap: variant, utility, token, transform, CSS.
 *
 * Usage:
 *   import { createTw } from "@tailwind-styled/plugin"
 *   const tw = createTw({
 *     plugins: [
 *       presetAnimation(),
 *       presetTokens({ primary: "#3b82f6" }),
 *     ]
 *   })
 *
 * Buat plugin sendiri:
 *   const myPlugin: TwPlugin = {
 *     name: "my-plugin",
 *     setup(ctx) {
 *       ctx.addVariant("print", sel => `@media print { ${sel} }`)
 *       ctx.addUtility("glow", { "box-shadow": "0 0 20px currentColor" })
 *       ctx.addToken("brand", "#ff4d6d")
 *     }
 *   }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

import type { compileCssFromClasses as CompileCssFn } from "@tailwind-styled/compiler"

export type VariantResolver = (selector: string) => string

export interface UtilityDefinition {
  [property: string]: string
}

export interface ComponentConfig {
  base: string
  variants: Record<string, Record<string, string>>
  compoundVariants: Array<{ class: string; [key: string]: any }>
  defaultVariants: Record<string, string>
}

export interface TransformMeta {
  componentName: string
  tag: string
}

export type TransformFn = (config: ComponentConfig, meta: TransformMeta) => ComponentConfig

export type CssHook = (css: string) => string
export type TokenMap = Record<string, string>

export interface TwContext {
  /** Add a new variant (e.g. "group-hover", "print", "rtl") */
  addVariant(name: string, resolver: VariantResolver): void
  /** Add a new utility class */
  addUtility(name: string, styles: UtilityDefinition): void
  /** Add a design token (becomes CSS custom property) */
  addToken(name: string, value: string): void
  /** Add object-config transform hook for tw.tag({ ... }) */
  addTransform(fn: TransformFn): void
  /** Hook into CSS generation phase */
  onGenerateCSS(hook: CssHook): void
  /** Hook into build end */
  onBuildEnd(hook: () => void | Promise<void>): void
  /** Get latest live token value by name (if token engine is available). */
  getToken(name: string): string | undefined
  /** Subscribe to token updates. Returns unsubscribe callback. */
  subscribeTokens(callback: (tokens: TokenMap) => void): () => void
  /** Read current plugin config */
  readonly config: Record<string, any>
}

export interface TwPlugin {
  name: string
  setup(ctx: TwContext): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Registry — singleton per engine instance
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginRegistry {
  variants: Map<string, VariantResolver>
  utilities: Map<string, UtilityDefinition>
  tokens: Map<string, string>
  transforms: TransformFn[]
  cssHooks: CssHook[]
  buildHooks: Array<() => void | Promise<void>>
  plugins: Set<string>
}

function createRegistry(): PluginRegistry {
  return {
    variants: new Map(),
    utilities: new Map(),
    tokens: new Map(),
    transforms: [],
    cssHooks: [],
    buildHooks: [],
    plugins: new Set(),
  }
}

// Global registry — dipakai bila createTw() tidak digunakan
let _globalRegistry: PluginRegistry = createRegistry()

export function getGlobalRegistry(): PluginRegistry {
  return _globalRegistry
}

export function resetGlobalRegistry(): void {
  _globalRegistry = createRegistry()
}

interface LiveTokenEngineLike {
  getToken?: (name: string) => string | undefined
  getTokens?: () => TokenMap
  subscribeTokens?: (callback: (tokens: TokenMap) => void) => () => void
  subscribe?: (callback: (tokens: TokenMap) => void) => () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toTokenEngine(value: unknown): LiveTokenEngineLike | null {
  if (!isRecord(value)) return null
  if (typeof value.getToken === "function") return value as LiveTokenEngineLike
  if (typeof value.getTokens === "function") return value as LiveTokenEngineLike
  return null
}

function readGlobalTokenEngine(): LiveTokenEngineLike | null {
  if (!isRecord(globalThis)) return null
  return toTokenEngine((globalThis as Record<string, unknown>).__TW_TOKEN_ENGINE__)
}

function readToken(engine: LiveTokenEngineLike | null, name: string): string | undefined {
  if (!engine) return undefined
  if (typeof engine.getToken === "function") return engine.getToken(name)
  if (typeof engine.getTokens === "function") {
    const tokens = engine.getTokens()
    if (isRecord(tokens) && typeof tokens[name] === "string") return tokens[name] as string
  }
  return undefined
}

let _cachedTokenEngine: LiveTokenEngineLike | null = null

/**
 * Resolve token engine from various sources:
 * 1. globalThis.__TW_TOKEN_ENGINE__
 * 2. @tailwind-styled/runtime (liveTokenEngine)
 * 3. @tailwind-styled/theme (v5 token engine)
 * 4. @tailwind-styled/runtime-css (v5 runtime)
 * 5. tailwind-styled-v4 (legacy)
 */
function resolveTokenEngine(): LiveTokenEngineLike | null {
  const globalEngine = readGlobalTokenEngine()
  if (globalEngine) {
    _cachedTokenEngine = globalEngine
    return globalEngine
  }

  if (_cachedTokenEngine) return _cachedTokenEngine

  let runtimeRequire: ((id: string) => unknown) | null = null
  try {
    runtimeRequire = Function("return typeof require === 'function' ? require : null")() as
      | ((id: string) => unknown)
      | null
  } catch {
    runtimeRequire = null
  }

  if (!runtimeRequire) return null

  // v5: Updated module list with new packages
  const moduleNames = [
    "@tailwind-styled/runtime",
    "@tailwind-styled/theme",
    "@tailwind-styled/runtime-css",
    "tailwind-styled-v4",
  ]

  for (const moduleName of moduleNames) {
    try {
      const loaded = runtimeRequire(moduleName) as Record<string, unknown> | null
      if (!loaded) continue

      // Check liveTokenEngine property first
      const fromNamed = toTokenEngine(loaded.liveTokenEngine)
      if (fromNamed) {
        _cachedTokenEngine = fromNamed
        return fromNamed
      }

      // Check root export
      const fromRoot = toTokenEngine(loaded)
      if (fromRoot) {
        _cachedTokenEngine = fromRoot
        return fromRoot
      }
    } catch {
      // ignore missing optional runtime modules
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Context factory
// ─────────────────────────────────────────────────────────────────────────────

function createContext(registry: PluginRegistry, config: Record<string, any> = {}): TwContext {
  return {
    config,

    addVariant(name, resolver) {
      if (registry.variants.has(name)) {
        console.warn(
          `[tailwind-styled-v4] Plugin variant "${name}" already registered — overwriting.`
        )
      }
      registry.variants.set(name, resolver)
    },

    addUtility(name, styles) {
      registry.utilities.set(name, styles)
    },

    addToken(name, value) {
      // Normalize to CSS variable friendly name
      const normalized = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      registry.tokens.set(normalized, value)
    },

    addTransform(fn) {
      registry.transforms.push(fn)
    },

    onGenerateCSS(hook) {
      registry.cssHooks.push(hook)
    },

    onBuildEnd(hook) {
      registry.buildHooks.push(hook)
    },

    getToken(name) {
      const engine = resolveTokenEngine()
      return readToken(engine, name)
    },

    subscribeTokens(callback) {
      const engine = resolveTokenEngine()
      if (!engine) return () => {}

      if (typeof engine.subscribeTokens === "function") {
        return engine.subscribeTokens(callback)
      }

      if (typeof engine.subscribe === "function") {
        return engine.subscribe(callback)
   
