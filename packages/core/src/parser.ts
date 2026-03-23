/**
 * tailwind-styled-v4 — Class parser
 *
 * Tries the Rust native binding first (parse_classes via napi),
 * falls back to the JS implementation when the binding is unavailable.
 *
 * Public API is unchanged — same types and functions as before.
 */

// Lazy load Node built-ins — browser safe (never called in browser context)
const _getNodePath = () => (typeof require !== "undefined" ? require("path") : null)
const _getCreateRequire = () => {
  if (typeof require !== "undefined") {
    try {
      return require("module").createRequire
    } catch {
      return null
    }
  }
  return null
}

// ── Types (re-exported so consumers don't need to change imports) ─────────────

export interface ParsedClassModifier {
  type: "opacity" | "arbitrary"
  value: string
}

export interface ParsedClass {
  raw: string
  base: string
  variants: string[]
  modifier?: ParsedClassModifier
}

// ── Rust native binding ───────────────────────────────────────────────────────

interface NativeParserBinding {
  parseClasses?: (input: string) => Array<{
    raw: string
    base: string
    variants: string[]
    modifierType?: string | null
    modifierValue?: string | null
  }>
}

let _binding: NativeParserBinding | null | undefined

function getBinding(): NativeParserBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    return (_binding = null)
  }
  // Guard: skip entirely in browser environment
  if (typeof process === "undefined" || typeof process.cwd !== "function") {
    return (_binding = null)
  }

  const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd()

  // Lazy-load Node built-ins — safe in browser (never reached due to guard above)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = _getNodePath()
  const nodeCreateRequire = _getCreateRequire()
  if (!nodePath) return (_binding = null)

  const req =
    typeof require === "function"
      ? require
      : nodeCreateRequire
        ? nodeCreateRequire(nodePath.join(runtimeDir, "noop.cjs"))
        : null

  if (!req) return (_binding = null)

  const candidates = [
    nodePath.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    nodePath.resolve(runtimeDir, "..", "..", "..", "native", "tailwind_styled_parser.node"),
    nodePath.resolve(runtimeDir, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]

  for (const c of candidates) {
    try {
      const mod = req(c) as NativeParserBinding
      if (mod?.parseClasses) return (_binding = mod)
    } catch {
      /* try next */
    }
  }

  return (_binding = null)
}

// ── JS fallback implementations ───────────────────────────────────────────────

function splitClassListJS(input: string): string[] {
  const out: string[] = []
  let token = ""
  let square = 0
  let round = 0
  let escaped = false

  for (const ch of input) {
    if (escaped) {
      token += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      token += ch
      escaped = true
      continue
    }
    if (ch === "[") square++
    else if (ch === "]") square = Math.max(0, square - 1)
    else if (ch === "(") round++
    else if (ch === ")") round = Math.max(0, round - 1)
    const isSpace = /\s/.test(ch)
    if (isSpace && square === 0 && round === 0) {
      if (token.trim().length > 0) out.push(token.trim())
      token = ""
      continue
    }
    token += ch
  }
  if (token.trim().length > 0) out.push(token.trim())
  return out
}

function parseClassTokenJS(rawToken: string): ParsedClass {
  const parts: string[] = []
  let current = ""
  let square = 0
  let round = 0
  let escaped = false

  for (const ch of rawToken) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      current += ch
      escaped = true
      continue
    }
    if (ch === "[") square++
    else if (ch === "]") square = Math.max(0, square - 1)
    else if (ch === "(") round++
    else if (ch === ")") round = Math.max(0, round - 1)
    if (ch === ":" && square === 0 && round === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += ch
  }
  parts.push(current)

  const variants = parts.slice(0, -1).filter(Boolean)
  const baseToken = parts[parts.length - 1] ?? ""
  const parsed: ParsedClass = { raw: rawToken, base: baseToken, variants }

  const opacityMatch = baseToken.match(/^(.*)\/(\d{1,3})$/)
  if (opacityMatch && opacityMatch[1].length > 0) {
    parsed.base = opacityMatch[1]
    parsed.modifier = { type: "opacity", value: opacityMatch[2] }
    return parsed
  }

  const arbitraryMatch = baseToken.match(/\((--[a-zA-Z0-9_-]+)\)/)
  if (arbitraryMatch) {
    parsed.modifier = { type: "arbitrary", value: arbitraryMatch[1] }
  }

  return parsed
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Split a Tailwind class string, preserving bracket/parenthesis expressions.
 * Uses Rust napi when available, JS fallback otherwise.
 */
export function splitClassList(input: string): string[] {
  const binding = getBinding()
  if (binding?.parseClasses) {
    try {
      return binding.parseClasses(input).map((p) => p.raw)
    } catch {
      /* fall through */
    }
  }
  return splitClassListJS(input)
}

/**
 * Parse a single Tailwind class token into variants + base + modifier metadata.
 * Uses Rust napi when available, JS fallback otherwise.
 */
export function parseClassToken(rawToken: string): ParsedClass {
  const binding = getBinding()
  if (binding?.parseClasses) {
    try {
      const results = binding.parseClasses(rawToken)
      if (results.length === 1) {
        const r = results[0]
        const parsed: ParsedClass = {
          raw: r.raw,
          base: r.base,
          variants: r.variants,
        }
        if (r.modifierType && r.modifierValue) {
          parsed.modifier = {
            type: r.modifierType as "opacity" | "arbitrary",
            value: r.modifierValue,
          }
        }
        return parsed
      }
    } catch {
      /* fall through */
    }
  }
  return parseClassTokenJS(rawToken)
}

/**
 * Parse all Tailwind classes in a space-separated string.
 * Uses Rust napi for bulk parsing when available.
 */
export function parseTailwindClasses(input: string): ParsedClass[] {
  const binding = getBinding()
  if (binding?.parseClasses) {
    try {
      return binding.parseClasses(input).map((r) => {
        const parsed: ParsedClass = { raw: r.raw, base: r.base, variants: r.variants }
        if (r.modifierType && r.modifierValue) {
          parsed.modifier = {
            type: r.modifierType as "opacity" | "arbitrary",
            value: r.modifierValue,
          }
        }
        return parsed
      })
    } catch {
      /* fall through */
    }
  }
  return splitClassListJS(input).map(parseClassTokenJS)
}
