/**
 * @tailwind-styled/runtime — unit tests
 * Run: node --test packages/runtime/test/index.test.mjs
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

let mod
try {
  mod = require(path.resolve(__dirname, "../dist/index.js"))
} catch {
  console.warn("[runtime test] dist not found — run `npm run build -w packages/runtime` first")
  process.exit(0)
}

const {
  applyTokenSet,
  createComponent,
  cx,
  getToken,
  getTokens,
  liveToken,
  liveTokenEngine,
  setToken,
  subscribeTokens,
  tokenRef,
  tokenVar,
} = mod

// React.forwardRef returns an object with $$typeof = Symbol(react.forward_ref)
// and a .render function — check for that instead of typeof === 'function'
function isReactComponent(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof v.render === "function"
  )
}

// ── cx ──────────────────────────────────────────────────────────────────────

describe("cx", () => {
  it("joins class strings", () => {
    assert.equal(cx("foo", "bar"), "foo bar")
  })

  it("filters falsy values", () => {
    assert.equal(cx("foo", false, null, undefined, "bar"), "foo bar")
  })

  it("flattens nested arrays", () => {
    assert.equal(cx(["foo", ["bar", "baz"]]), "foo bar baz")
  })

  it("returns empty string for all falsy", () => {
    assert.equal(cx(false, null, undefined), "")
  })

  it("handles numbers", () => {
    // 0 is falsy in JS, so cx skips it — this is expected behavior
    assert.equal(cx("foo", 0, "bar"), "foo bar")
  })
})

// ── live token engine ─────────────────────────────────────────────────────────

describe("live token engine", () => {
  it("exports token helpers", () => {
    assert.equal(typeof tokenVar, "function")
    assert.equal(typeof tokenRef, "function")
    assert.equal(tokenVar("color-primary"), "--tw-token-color-primary")
    assert.equal(tokenRef("color-primary"), "var(--tw-token-color-primary)")
  })

  it("setToken/getToken/getTokens work", () => {
    setToken("color-primary", "#123456")
    assert.equal(getToken("color-primary"), "#123456")
    const snapshot = getTokens()
    assert.equal(snapshot["color-primary"], "#123456")
  })

  it("subscribeTokens receives updates", () => {
    let observed = null
    const unsubscribe = subscribeTokens((tokens) => {
      observed = tokens["color-subscriber"]
    })

    setToken("color-subscriber", "#abcdef")
    unsubscribe()

    assert.equal(observed, "#abcdef")
  })

  it("liveToken and applyTokenSet update token state", () => {
    const theme = liveToken({ "color-brand": "#111111" })
    assert.equal(theme.get("color-brand"), "#111111")
    applyTokenSet({ "color-brand": "#222222" })
    assert.equal(getToken("color-brand"), "#222222")
  })

  it("liveTokenEngine bridge is available", () => {
    assert.equal(typeof liveTokenEngine, "object")
    assert.equal(typeof liveTokenEngine.getToken, "function")
    assert.equal(typeof liveTokenEngine.subscribeTokens, "function")
  })
})

// ── createComponent — simple ─────────────────────────────────────────────────

describe("createComponent — simple", () => {
  it("returns a React forwardRef component", () => {
    const Div = createComponent("div", "Container_abc123")
    assert.ok(isReactComponent(Div), "should be a React forwardRef component")
  })

  it("has correct displayName", () => {
    const Div = createComponent("div", "Container_abc123")
    assert.equal(Div.displayName, "tw.div")
  })

  it("has no sub-properties for simple component", () => {
    const Div = createComponent("div", "Container_abc123")
    assert.equal(Div.icon, undefined)
    assert.equal(Div.text, undefined)
  })
})

// ── createComponent — compound ───────────────────────────────────────────────

describe("createComponent — compound", () => {
  const Button = createComponent(
    "button",
    "Button_xyz123",
    {
      icon: { tag: "span", class: "Button_icon_xyz123" },
      text: { tag: "span", class: "Button_text_xyz123" },
    },
    { fullWidth: "w-full" }
  )

  it("base is a React forwardRef component", () => {
    assert.ok(isReactComponent(Button), "base should be a React component")
  })

  it("attaches .icon subcomponent", () => {
    assert.ok(isReactComponent(Button.icon), ".icon should be a React component")
  })

  it("attaches .text subcomponent", () => {
    assert.ok(isReactComponent(Button.text), ".text should be a React component")
  })

  it("subcomponents have displayNames", () => {
    assert.equal(Button.icon.displayName, "tw.button.icon")
    assert.equal(Button.text.displayName, "tw.button.text")
  })

  it("base component has correct displayName", () => {
    assert.equal(Button.displayName, "tw.button")
  })
})

// ── createComponent — no subComponents ───────────────────────────────────────

describe("createComponent — no subComponents", () => {
  it("works without subComponents argument", () => {
    const Span = createComponent("span", "Span_aaa")
    assert.ok(isReactComponent(Span))
  })

  it("works with empty subComponents", () => {
    const Span = createComponent("span", "Span_aaa", {})
    assert.ok(isReactComponent(Span))
  })

  it("works without conditionals", () => {
    const Div = createComponent("div", "Div_bbb", { body: { class: "Div_body_bbb" } })
    assert.ok(isReactComponent(Div.body))
  })
})

// ── createComponent — conditionals ───────────────────────────────────────────

describe("createComponent — conditionals", () => {
  it("accepts conditionals without throwing", () => {
    assert.doesNotThrow(() => {
      createComponent(
        "div",
        "Card_abc",
        { body: { tag: "div", class: "Card_body_abc" } },
        { fullWidth: "w-full", shadow: "shadow-lg" }
      )
    })
  })

  it("subcomponent tag override works", () => {
    const Card = createComponent("div", "Card_abc", {
      header: { tag: "header", class: "Card_header_abc" },
      footer: { tag: "footer", class: "Card_footer_abc" },
    })
    assert.ok(isReactComponent(Card.header))
    assert.ok(isReactComponent(Card.footer))
  })
})

// ── cx edge cases ─────────────────────────────────────────────────────────────

describe("cx — edge cases", () => {
  it("deduplication not done by cx (intentional)", () => {
    // cx is a simple joiner, dedup is handled by Tailwind's merge if needed
    assert.equal(cx("foo", "foo"), "foo foo")
  })

  it("empty strings are filtered (falsy)", () => {
    // empty string is falsy → filtered out, same as false/null
    assert.equal(cx("foo", "", "bar"), "foo bar")
  })
})

console.log("✅ @tailwind-styled/runtime tests complete")
