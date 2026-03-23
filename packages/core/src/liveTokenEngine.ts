/**
 * tailwind-styled-v4 — Live Token Engine
 *
 * Runtime design token management via CSS custom properties.
 * Theme changes propagate instantly — no rebuild, no re-render.
 *
 * Usage:
 *   import { liveToken, setToken, setTokens, subscribeTokens } from "tailwind-styled-v4"
 *
 *   // Define tokens (injected as CSS vars on first call)
 *   const theme = liveToken({
 *     primary:    "#3b82f6",
 *     secondary:  "#6366f1",
 *     accent:     "#f59e0b",
 *     surface:    "#18181b",
 *     "text-base": "#e4e4e7",
 *   })
 *
 *   // Use in components
 *   const Button = tw.button`
 *     bg-[var(--tw-token-primary)]
 *     text-[var(--tw-token-text-base)]
 *   `
 *
 *   // Update at runtime (instant, no rebuild)
 *   setToken("primary", "#ef4444")     // single token
 *   setTokens({ primary: "#ef4444", secondary: "#ec4899" }) // batch
 *
 *   // Switch themes
 *   applyTokenSet(darkTheme)
 *
 *   // Subscribe to changes
 *   const unsub = subscribeTokens((tokens) => {
 *     console.log("theme changed", tokens)
 *   })
 *
 * Token CSS variable naming:
 *   token("primary") → var(--tw-token-primary)
 *   token("text-base") → var(--tw-token-text-base)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TokenMap = Record<string, string>

export interface LiveTokenSet {
  /** Token name → CSS variable name mapping */
  vars: Record<string, string>
  /** Get current value of a token */
  get(name: string): string | undefined
  /** Update a single token */
  set(name: string, value: string): void
  /** Update multiple tokens at once */
  setAll(tokens: TokenMap): void
  /** Snapshot of current values */
  snapshot(): TokenMap
}

export type TokenSubscriber = (tokens: TokenMap) => void

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

let _currentTokens: TokenMap = {}
const _subscribers = new Set<TokenSubscriber>()
let _styleEl: HTMLStyleElement | null = null

// Devtools integration
if (typeof window !== "undefined") {
  ;(window as any).__TW_TOKEN_ENGINE__ = {
    getTokens: () => _currentTokens,
    setToken: (name: string, value: string) => setToken(name, value),
    subscribe: (fn: TokenSubscriber) => subscribeTokens(fn),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS variable name
// ─────────────────────────────────────────────────────────────────────────────

export function tokenVar(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
  return `--tw-token-${normalized}`
}

export function tokenRef(name: string): string {
  return `var(${tokenVar(name)})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Style injection
// ─────────────────────────────────────────────────────────────────────────────

function buildRootCss(tokens: TokenMap): string {
  const vars = Object.entries(tokens)
    .map(([name, value]) => `  ${tokenVar(name)}: ${value};`)
    .join("\n")
  return `:root {\n${vars}\n}`
}

function syncStyleEl(): void {
  if (typeof document === "undefined") return

  if (!_styleEl) {
    _styleEl = document.createElement("style")
    _styleEl.id = "tw-live-tokens"
    _styleEl.setAttribute("data-tw-tokens", "true")
    document.head.appendChild(_styleEl)
  }

  _styleEl.textContent = buildRootCss(_currentTokens)
}

function notifySubscribers(): void {
  const snapshot = { ..._currentTokens }
  for (const sub of _subscribers) {
    try {
      sub(snapshot)
    } catch {
      /* silent */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Define a set of live tokens and inject them as CSS variables.
 * Returns a LiveTokenSet for programmatic control.
 *
 * @example
 * const theme = liveToken({ primary: "#3b82f6" })
 * theme.set("primary", "#ef4444") // instant update
 */
export function liveToken(tokens: TokenMap): LiveTokenSet {
  // Merge into current token map
  _currentTokens = { ..._currentTokens, ...tokens }
  syncStyleEl()

  const vars: Record<string, string> = {}
  for (const name of Object.keys(tokens)) {
    vars[name] = tokenRef(name)
  }

  return {
    vars,
    get(name) {
      return _currentTokens[name]
    },
    set(name, value) {
      setToken(name, value)
    },
    setAll(newTokens) {
      setTokens(newTokens)
    },
    snapshot() {
      return { ..._currentTokens }
    },
  }
}

/**
 * Update a single design token at runtime.
 * CSS variable is updated immediately — no rebuild needed.
 */
export function setToken(name: string, value: string): void {
  _currentTokens = { ..._currentTokens, [name]: value }

  // Fast path: update CSSOM directly if possible
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(tokenVar(name), value)
  }

  notifySubscribers()
}

/**
 * Update multiple tokens in one batch (single DOM update).
 */
export function setTokens(tokens: TokenMap): void {
  _currentTokens = { ..._currentTokens, ...tokens }

  if (typeof document !== "undefined") {
    const root = document.documentElement
    for (const [name, value] of Object.entries(tokens)) {
      root.style.setProperty(tokenVar(name), value)
    }
  }

  notifySubscribers()
}

/**
 * Replace all tokens with a new token set (theme switch).
 */
export function applyTokenSet(tokens: TokenMap): void {
  // Remove old vars
  if (typeof document !== "undefined") {
    const root = document.documentElement
    for (const name of Object.keys(_currentTokens)) {
      if (!(name in tokens)) {
        root.style.removeProperty(tokenVar(name))
      }
    }
  }

  _currentTokens = { ...tokens }
  syncStyleEl()
  notifySubscribers()
}

/**
 * Get current value of a token.
 */
export function getToken(name: string): string | undefined {
  return _currentTokens[name]
}

/**
 * Get snapshot of all current tokens.
 */
export function getTokens(): TokenMap {
  return { ..._currentTokens }
}

/**
 * Subscribe to token changes.
 * Returns unsubscribe function.
 *
 * @example
 * const unsub = subscribeTokens((tokens) => {
 *   document.documentElement.classList.toggle("dark", tokens.surface === "#000")
 * })
 * // Later:
 * unsub()
 */
export function subscribeTokens(fn: TokenSubscriber): () => void {
  _subscribers.add(fn)
  return () => {
    _subscribers.delete(fn)
  }
}

/**
 * Generate SSR-safe CSS string for current tokens.
 */
export function generateTokenCssString(): string {
  return buildRootCss(_currentTokens)
}

/**
 * React hook for reading live tokens (re-renders on change).
 * Import from tailwind-styled-v4/react.
 */
export function createUseTokens() {
  // Lazy import React to avoid issues in non-React environments
  let useState: any, useEffect: any
  try {
    const react = require("react")
    useState = react.useState
    useEffect = react.useEffect
  } catch {
    return null
  }

  return function useTokens(): TokenMap {
    const [tokens, setTokens_] = (useState as <S>(init: S) => [S, (v: S) => void])<TokenMap>({
      ..._currentTokens,
    })

    useEffect(() => {
      // Sync on mount
      setTokens_({ ..._currentTokens })
      const unsub = subscribeTokens((t) => setTokens_({ ...t }))
      return unsub
    }, [])

    return tokens
  }
}
