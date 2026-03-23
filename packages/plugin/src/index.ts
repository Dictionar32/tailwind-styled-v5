import type {
  LoadResult,
  PartialResolvedId,
  PluginContext,
  ResolveIdResult,
  TransformResult,
} from "rollup"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TwClassResult {
  css: string
  classes: string[]
}

export interface DesignTokens {
  [key: string]: string | number | DesignTokens
}

export interface TwPluginOptions {
  classProcessor?: (classes: string[]) => TwClassResult
  tokens?: DesignTokens
  debug?: boolean
  minify?: boolean
}

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
  addVariant(name: string, resolver: VariantResolver): void
  addUtility(name: string, styles: UtilityDefinition): void
  addToken(name: string, value: string): void
  addTransform(fn: TransformFn): void
  onGenerateCSS(hook: CssHook): void
  onBuildEnd(hook: () => void | Promise<void>): void
  getToken(name: string): string | undefined
  subscribeTokens(callback: (tokens: TokenMap) => void): () => void
  readonly config: Record<string, any>
}

// Legacy TwPlugin interface for plugin development
export interface TwPlugin {
  name: string
  setup(ctx: TwContext): void
}

export interface PluginRegistry {
  variants: Map<string, VariantResolver>
  utilities: Map<string, UtilityDefinition>
  tokens: Map<string, string>
  transforms: TransformFn[]
  cssHooks: CssHook[]
  buildHooks: Array<() => void | Promise<void>>
  plugins: Set<string>
}

// ── Token Engine helpers ─────────────────────────────────────────────────────

const TOKEN_ENGINE_KEY = "__TW_TOKEN_ENGINE__"

function resolveTokenEngine(): any {
  if (typeof globalThis !== "undefined") {
    return (globalThis as any)[TOKEN_ENGINE_KEY]
  }
  return null
}

function readToken(engine: any, name: string): string | undefined {
  if (!engine) return undefined
  if (typeof engine.getToken === "function") return engine.getToken(name)
  if (typeof engine.getTokens === "function") {
    const tokens = engine.getTokens()
    return tokens?.[name]
  }
  return undefined
}

// ── Vite/Rollup Plugin (separate from legacy TwPlugin) ─────────────────────

export interface TwVitePlugin {
  resolveId(
    this: PluginContext,
    source: string,
    importer: string
  ): Promise<PartialResolvedId | null>
  load(this: PluginContext, id: string): Promise<LoadResult | null>
  transform(this: PluginContext, code: string, id: string): Promise<TransformResult | null>
  getToken(name: string): string | undefined
  subscribeTokens(callback: (tokens: Record<string, string>) => void): () => void
}

export function createTwPlugin(options: TwPluginOptions = {}): TwVitePlugin {
  return {
    async resolveId(source, importer) {
      if (!source.startsWith("tw.") && !source.startsWith("tw:")) return null
      const importPath = source.replace(/^tw[.:]/, "")
      const resolved = await this.resolve(importPath, importer, { skipSelf: true })
      if (resolved) return { id: resolved.id }
      return null
    },
    async load(id) {
      return null
    },
    async transform(code, id) {
      return null
    },
    getToken(name) {
      const engine = resolveTokenEngine()
      return readToken(engine, name)
    },
    subscribeTokens(callback) {
      const engine = resolveTokenEngine()
      if (!engine) return () => {}
      if (typeof engine.subscribeTokens === "function") return engine.subscribeTokens(callback)
      if (typeof engine.subscribe === "function") return engine.subscribe(callback)
      return () => {}
    },
  }
}

// ── Global Registry (for @tailwind-styled/compiler) ───────────────────────────

export interface TwGlobalRegistry {
  transforms: Array<(config: any, ctx: any) => any>
  tokens: Record<string, string>
}

const globalRegistry: TwGlobalRegistry = {
  transforms: [],
  tokens: {},
}

export function getGlobalRegistry(): TwGlobalRegistry {
  return globalRegistry
}

export function registerTransform(transform: (config: any, ctx: any) => any): void {
  globalRegistry.transforms.push(transform)
}

export function registerToken(name: string, value: string): void {
  globalRegistry.tokens[name] = value
}

// ── Legacy exports for backward compatibility ─────────────────────────────--

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

let _globalRegistry: PluginRegistry = createRegistry()

export function resetGlobalRegistry(): void {
  _globalRegistry = createRegistry()
}

function createContext(registry: PluginRegistry, config: Record<string, any> = {}): TwContext {
  return {
    config,
    addVariant(name, resolver) {
      registry.variants.set(name, resolver)
    },
    addUtility(name, styles) {
      registry.utilities.set(name, styles)
    },
    addToken(name, value) {
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
      return readToken(resolveTokenEngine(), name)
    },
    subscribeTokens(callback) {
      const engine = resolveTokenEngine()
      if (!engine) return () => {}
      if (typeof engine.subscribeTokens === "function") return engine.subscribeTokens(callback)
      if (typeof engine.subscribe === "function") return engine.subscribe(callback)
      return () => {}
    },
  }
}

// Legacy createTw function for backward compatibility
export function createTw(config: Record<string, any> = {}): TwContext {
  const ctx = createContext(_globalRegistry, config)
  // Note: This doesn't actually run plugins - that's done by the compiler
  return ctx
}

export function use(plugin: TwPlugin): void {
  const ctx = createContext(_globalRegistry)
  plugin.setup(ctx)
}

// Simple preset helpers
export function presetTokens(tokens: Record<string, string>): TwPlugin {
  return {
    name: "preset-tokens",
    setup(ctx) {
      for (const [name, value] of Object.entries(tokens)) {
        ctx.addToken(name, value)
      }
    },
  }
}

export function presetVariants(variants: Record<string, VariantResolver>): TwPlugin {
  return {
    name: "preset-variants",
    setup(ctx) {
      for (const [name, resolver] of Object.entries(variants)) {
        ctx.addVariant(name, resolver)
      }
    },
  }
}

export function presetScrollbar(): TwPlugin {
  return {
    name: "preset-scrollbar",
    setup(ctx) {
      ctx.addVariant("scrollbar-thin", () => "::-webkit-scrollbar{width:8px;height:8px}")
      ctx.addVariant("scrollbar-none", () => "::-webkit-scrollbar{display:none}")
      ctx.addUtility("scrollbar-hide", { "-ms-overflow-style": "none", "scrollbar-width": "none" })
    },
  }
}
