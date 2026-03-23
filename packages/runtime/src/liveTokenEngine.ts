import React from "react"

export type TokenMap = Record<string, string>
export type TokenSubscriber = (tokens: TokenMap) => void

export interface LiveTokenSet {
  vars: Record<string, string>
  get(name: string): string | undefined
  set(name: string, value: string): void
  setAll(tokens: TokenMap): void
  snapshot(): TokenMap
}

export interface LiveTokenEngineBridge {
  getToken(name: string): string | undefined
  getTokens(): TokenMap
  setToken(name: string, value: string): void
  applyTokenSet(tokens: TokenMap): void
  subscribeTokens(fn: TokenSubscriber): () => void
  subscribe?(fn: TokenSubscriber): () => void
}

declare global {
  var __TW_TOKEN_ENGINE__: LiveTokenEngineBridge | undefined
}

let _currentTokens: TokenMap = {}
const _subscribers = new Set<TokenSubscriber>()
let _styleEl: HTMLStyleElement | null = null

export function tokenVar(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
  return `--tw-token-${normalized}`
}

export function tokenRef(name: string): string {
  return `var(${tokenVar(name)})`
}

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
  for (const subscriber of _subscribers) {
    try {
      subscriber(snapshot)
    } catch {
      // intentionally ignore subscriber errors
    }
  }
}

export function liveToken(tokens: TokenMap): LiveTokenSet {
  _currentTokens = { ..._currentTokens, ...tokens }
  syncStyleEl()
  notifySubscribers()

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
    setAll(nextTokens) {
      setTokens(nextTokens)
    },
    snapshot() {
      return { ..._currentTokens }
    },
  }
}

export function setToken(name: string, value: string): void {
  _currentTokens = { ..._currentTokens, [name]: value }

  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(tokenVar(name), value)
  }

  notifySubscribers()
}

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

export function applyTokenSet(tokens: TokenMap): void {
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

export function getToken(name: string): string | undefined {
  return _currentTokens[name]
}

export function getTokens(): TokenMap {
  return { ..._currentTokens }
}

export function subscribeTokens(fn: TokenSubscriber): () => void {
  _subscribers.add(fn)
  return () => {
    _subscribers.delete(fn)
  }
}

export function generateTokenCssString(): string {
  return buildRootCss(_currentTokens)
}

export function createUseTokens() {
  return function useTokens(): TokenMap {
    const [tokens, setTokensState] = React.useState<TokenMap>({ ..._currentTokens })

    React.useEffect(() => {
      setTokensState({ ..._currentTokens })
      return subscribeTokens((nextTokens) => setTokensState({ ...nextTokens }))
    }, [])

    return tokens
  }
}

export const liveTokenEngine: LiveTokenEngineBridge = {
  getToken,
  getTokens,
  setToken,
  applyTokenSet,
  subscribeTokens,
  subscribe: subscribeTokens,
}

globalThis.__TW_TOKEN_ENGINE__ = liveTokenEngine
if (typeof window !== "undefined") {
  ;(window as any).__TW_TOKEN_ENGINE__ = liveTokenEngine
}

