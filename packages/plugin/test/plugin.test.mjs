/**
 * Test suite: @tailwind-styled/plugin v5
 * Verifikasi: plugin system, presets, Rust CSS compiler integration
 */
import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const plugin = require(path.join(ROOT, "packages/plugin/dist/index.cjs"))

describe("Plugin registry", () => {
  beforeEach(() => {
    plugin.resetGlobalRegistry()
  })

  test("getGlobalRegistry returns registry", () => {
    const reg = plugin.getGlobalRegistry()
    assert.ok(typeof reg === "object")
    assert.ok(reg instanceof Map || "plugins" in reg)
  })

  test("resetGlobalRegistry clears state", () => {
    plugin.resetGlobalRegistry()
    const reg = plugin.getGlobalRegistry()
    assert.ok(typeof reg === "object")
  })

  test("use() registers plugin globally", () => {
    const myPlugin = {
      name: "test-plugin",
      setup(ctx) {
        ctx.addUtility("test-util", { display: "test" })
      }
    }
    plugin.use(myPlugin)
    const reg = plugin.getGlobalRegistry()
    assert.ok(reg.plugins.has("test-plugin"))
  })

  test("use() skips duplicate plugins", () => {
    const myPlugin = {
      name: "duplicate-test",
      setup(ctx) {
        ctx.addUtility("test", { color: "red" })
      }
    }
    plugin.use(myPlugin)
    const beforeCount = plugin.getGlobalRegistry().plugins.size

    // Should skip duplicate
    plugin.use(myPlugin)
    const afterCount = plugin.getGlobalRegistry().plugins.size
    assert.equal(beforeCount, afterCount)
  })
})

describe("createTw scoped instance", () => {
  test("createTw returns instance with registry and use function", () => {
    const tw = plugin.createTw({ plugins: [] })
    assert.ok(typeof tw === "object")
    assert.ok(typeof tw.registry === "object")
    assert.ok(typeof tw.use === "function")
  })

  test("createTw dengan plugin", () => {
    const myPlugin = {
      name: "scoped-plugin",
      setup(ctx) {
        ctx.addVariant("hocus", sel => `${sel}:hover, ${sel}:focus`)
      }
    }
    const tw = plugin.createTw({ plugins: [myPlugin] })
    assert.ok(tw.registry.plugins.has("scoped-plugin"))
  })

  test("createTw scoped registry is isolated from global", () => {
    const tw = plugin.createTw({ plugins: [] })
    const globalReg = plugin.getGlobalRegistry()

    // Scoped registry should be different from global
    assert.notEqual(tw.registry, globalReg)

    // Add to scoped registry
    tw.use({
      name: "scoped-only",
      setup(ctx) {
        ctx.addUtility("scoped-utility", { display: "none" })
      }
    })

    // Global registry should not have it
    assert.ok(!globalReg.utilities.has("scoped-utility"))
  })

  test("createTw returns use function that adds to scoped registry", () => {
    const tw = plugin.createTw({ plugins: [] })

    tw.use({
      name: "added-later",
      setup(ctx) {
        ctx.addToken("custom-token", "#123456")
      }
    })

    assert.ok(tw.registry.plugins.has("added-later"))
    assert.ok(tw.registry.tokens.has("custom-token"))
  })
})

describe("Built-in presets", () => {
  test("presetRustCompiler returns TwPlugin", () => {
    const p = plugin.presetRustCompiler()
    assert.equal(p.name, "tailwind-styled/preset-rust-compiler")
    assert.equal(typeof p.setup, "function")
  })

  test("presetTokens returns TwPlugin with color tokens", () => {
    const p = plugin.presetTokens({ primary: "#3b82f6", secondary: "#6366f1" })
    assert.equal(p.name, "preset-tokens")
    assert.equal(typeof p.setup, "function")

    // Execute setup to verify it works
    const mockCtx = {
      addToken: (name, value) => {},
      addUtility: () => {},
      addVariant: () => {},
      addTransform: () => {},
      onGenerateCSS: () => {},
      onBuildEnd: () => {},
    }
    p.setup(mockCtx)
  })

  test("presetVariants returns TwPlugin", () => {
    const p = plugin.presetVariants()
    assert.equal(p.name, "preset-variants")
    assert.equal(typeof p.setup, "function")

    // Verify variants are registered
    const variants = []
    p.setup({
      addVariant: (name, fn) => variants.push(name),
      addUtility: () => {},
      addToken: () => {},
      addTransform: () => {},
      onGenerateCSS: () => {},
      onBuildEnd: () => {},
    })
    assert.ok(variants.includes("group-hover"))
    assert.ok(variants.includes("rtl"))
    assert.ok(variants.includes("print"))
  })

  test("presetScrollbar returns TwPlugin", () => {
    const p = plugin.presetScrollbar()
    assert.equal(p.name, "preset-scrollbar")
    assert.equal(typeof p.setup, "function")

    const utilities = []
    p.setup({
      addUtility: (name, styles) => utilities.push(name),
      addVariant: () => {},
      addToken: () => {},
      addTransform: () => {},
      onGenerateCSS: () => {},
      onBuildEnd: () => {},
    })
    assert.ok(utilities.includes("scrollbar-none"))
    assert.ok(utilities.includes("scrollbar-thin"))
  })
})

describe("Official plugins (./plugins)", () => {
  test("pluginAnimation returns TwPlugin", () => {
    const p = plugin.pluginAnimation({ prefix: "custom-anim", reducedMotion: true })
    assert.equal(p.name, "tw-plugin-animation")
    assert.equal(typeof p.setup, "function")
  })

  test("pluginAnimation registers motion variants and utilities", () => {
    const p = plugin.pluginAnimation()
    const variants = []
    const utilities = []
    const cssHooks = []

    p.setup({
      addVariant: (name, fn) => variants.push(name),
      addUtility: (name, styles) => utilities.push(name),
      addToken: () => {},
      addTransform: () => {},
      onGenerateCSS: (fn) => cssHooks.push(fn),
      onBuildEnd: () => {},
    })

    assert.ok(variants.includes("motion-safe"))
    assert.ok(variants.includes("motion-reduce"))
    assert.ok(utilities.includes("animate-fade-in"))
    assert.ok(utilities.includes("animate-spin"))
    assert.ok(cssHooks.length > 0)
  })

  test("pluginTokens returns TwPlugin", () => {
    const p = plugin.pluginTokens({
      colors: { primary: "#3b82f6", secondary: "#6366f1" },
      fonts: { sans: "Inter, sans-serif" },
    })
    assert.equal(p.name, "tw-plugin-tokens")
    assert.equal(typeof p.setup, "function")
  })

  test("pluginTokens registers colors and utilities", () => {
    const p = plugin.pluginTokens({
      colors: { primary: "#3b82f6" },
      generateUtilities: true,
    })
    const tokens = new Map()
    const utilities = []
    const getToken = (name) => undefined

    p.setup({
      addToken: (name, value) => tokens.set(name, value),
      addUtility: (name, styles) => utilities.push(name),
      addVariant: () => {},
      addTransform: () => {},
      onGenerateCSS: () => {},
      onBuildEnd: () => {},
      getToken,
      subscribeTokens: () => () => {},
    })

    assert.ok(tokens.has("color-primary"))
    assert.ok(utilities.includes("bg-primary"))
    assert.ok(utilities.includes("text-primary"))
  })

  test("pluginTypography returns TwPlugin", () => {
    const p = plugin.pluginTypography({
      color: "#000000",
      fontFamily: "sans-serif",
      maxWidth: "70ch",
    })
    assert.equal(p.name, "tw-plugin-typography")
    assert.equal(typeof p.setup, "function")
  })

  test("pluginTypography registers prose utilities and variants", () => {
    const p = plugin.pluginTypography()
    const utilities = []
    const variants = []
    const cssHooks = []

    p.setup({
      addUtility: (name, styles) => utilities.push(name),
      addVariant: (name, fn) => variants.push(name),
      addToken: () => {},
      addTransform: () => {},
      onGenerateCSS: (fn) => cssHooks.push(fn),
      onBuildEnd: () => {},
    })

    assert.ok(utilities.includes("prose"))
    assert.ok(utilities.includes("prose-h1"))
    assert.ok(variants.includes("prose-invert"))
    assert.ok(cssHooks.length > 0)
  })
})

describe("Presets subpath (./presets)", () => {
  test("preset functions are exported from root", () => {
    assert.equal(typeof plugin.presetVariants, "function")
    assert.equal(typeof plugin.presetScrollbar, "function")
    assert.equal(typeof plugin.presetTokens, "function")
  })
})

describe("CSS generation (internal helpers)", () => {
  test("generateUtilityCss from plugin utilities", () => {
    plugin.use({
      name: "util-test",
      setup(ctx) { ctx.addUtility("glow", { "box-shadow": "0 0 20px currentColor" }) }
    })
    const reg = plugin.getGlobalRegistry()
    const css = plugin.generateUtilityCss(reg)
    assert.ok(typeof css === "string")
    assert.ok(css.includes(".glow"))
    assert.ok(css.includes("box-shadow"))
  })

  test("generateTokenCss from plugin tokens", () => {
    plugin.use({
      name: "token-test",
      setup(ctx) { ctx.addToken("brand", "#ff4d6d") }
    })
    const reg = plugin.getGlobalRegistry()
    const css = plugin.generateTokenCss(reg)
    assert.ok(typeof css === "string")
    assert.ok(css.includes(":root"))
    assert.ok(css.includes("--brand"))
  })

  test("applyCssHooks modifies CSS string", () => {
    plugin.use({
      name: "hook-test",
      setup(ctx) {
        ctx.onGenerateCSS((css) => css.replace("foo", "bar"))
      }
    })
    const reg = plugin.getGlobalRegistry()
    const result = plugin.applyCssHooks("foo bar baz", reg)
    assert.ok(result.includes("bar"))
  })

  test("runBuildHooks executes build hooks", async () => {
    let hookCalled = false
    plugin.use({
      name: "build-hook-test",
      setup(ctx) {
        ctx.onBuildEnd(async () => {
          hookCalled = true
        })
      }
    })
    const reg = plugin.getGlobalRegistry()
    await plugin.runBuildHooks(reg)
    assert.equal(hookCalled, true)
  })
})

describe("Live token integration", () => {
  afterEach(() => {
    plugin.resetGlobalRegistry()
  })

  test("ctx.getToken returns value from live token engine", () => {
    const prevEngine = globalThis.__TW_TOKEN_ENGINE__
    globalThis.__TW_TOKEN_ENGINE__ = {
      getToken(name) {
        if (name === "color-primary") return "#112233"
        return undefined
      },
      getTokens() {
        return { "color-primary": "#112233" }
      },
      subscribeTokens(fn) {
        return () => {}
      },
    }

    try {
      plugin.use(plugin.pluginTokens({ colors: { primary: "#3b82f6" } }))
      const reg = plugin.getGlobalRegistry()
      assert.equal(reg.tokens.get("color-primary"), "#112233")
    } finally {
      globalThis.__TW_TOKEN_ENGINE__ = prevEngine
    }
  })

  test("ctx.subscribeTokens receives updates", () => {
    const prevEngine = globalThis.__TW_TOKEN_ENGINE__
    let subscriber = null

    globalThis.__TW_TOKEN_ENGINE__ = {
      getToken(name) {
        if (name === "color-primary") return "#112233"
        return undefined
      },
      getTokens() {
        return { "color-primary": "#112233" }
      },
      subscribeTokens(fn) {
        subscriber = fn
        return () => { subscriber = null }
      },
      subscribe(fn) {
        subscriber = fn
        return () => { subscriber = null }
      },
    }

    try {
      plugin.use(plugin.pluginTokens({ colors: { primary: "#3b82f6" } }))
      const reg = plugin.getGlobalRegistry()

      subscriber?.({ "color-primary": "#ff0055" })
      assert.equal(reg.tokens.get("color-primary"), "#ff0055")
    } finally {
      globalThis.__TW_TOKEN_ENGINE__ = prevEngine
    }
  })
})

describe("Rust CSS integration (generateCssRust)", () => {
  test("generateCssRust exists and is async", () => {
    assert.equal(typeof plugin.generateCssRust, "function")
  })

  test("generateCssRust returns CSS for basic classes", async () => {
    const r = await plugin.generateCssRust(["flex", "items-center", "bg-blue-500"])
    assert.ok(typeof r.css === "string")
    assert.ok(r.css.length > 0, "CSS should not be empty")
    assert.ok(["rust", "fallback"].includes(r.engine))
    assert.ok(typeof r.resolvedCount === "number")
    assert.ok(typeof r.unknownCount === "number")
  })

  test("generateCssRust resolves known Tailwind classes", async () => {
    const r = await plugin.generateCssRust(["flex", "bg-blue-500", "hover:bg-blue-600"])
    assert.ok(r.css.includes("display: flex") || r.css.includes("display:flex"))
  })

  test("generateCssRust handles hover variant", async () => {
    const r = await plugin.generateCssRust(["hover:bg-blue-600"])
    assert.ok(r.css.includes(":hover") || r.css.includes("@media"), `Expected hover or media query, got: ${r.css.slice(0, 100)}`)
  })

  test("generateCssRust counts unknown classes", async () => {
    const r = await plugin.generateCssRust(["totally-unknown-class-xyz", "flex"])
    assert.ok(typeof r.unknownCount === "number")
    assert.ok(typeof r.resolvedCount === "number")
  })
})

describe("Edge cases", () => {
  beforeEach(() => {
    plugin.resetGlobalRegistry()
  })

  test("empty registry generates empty CSS", () => {
    const reg = plugin.getGlobalRegistry()
    assert.equal(plugin.generateUtilityCss(reg), "")
    assert.equal(plugin.generateTokenCss(reg), "")
  })

  test("multiple plugins can add same variant name (warning expected)", () => {
    const p1 = {
      name: "plugin-1",
      setup(ctx) { ctx.addVariant("test", sel => `.test ${sel}`) }
    }
    const p2 = {
      name: "plugin-2",
      setup(ctx) { ctx.addVariant("test", sel => `.other ${sel}`) }
    }
    plugin.use(p1)
    plugin.use(p2)

    const reg = plugin.getGlobalRegistry()
    // Second one should overwrite first (warning expected in real usage)
    assert.ok(reg.variants.has("test"))
  })

  test("createTw with empty options returns valid instance", () => {
    const tw = plugin.createTw()
    assert.ok(typeof tw.registry === "object")
    assert.ok(typeof tw.use === "function")
  })

  test("presetTokens normalizes token names", () => {
    plugin.use(plugin.presetTokens({ "Primary Color": "#fff", "my-token": "#000" }))
    const reg = plugin.getGlobalRegistry()

    assert.ok(reg.tokens.has("color-primary-color") || reg.tokens.has("color-primary-color"))
    assert.ok(reg.tokens.has("color-my-token"))
  })
})