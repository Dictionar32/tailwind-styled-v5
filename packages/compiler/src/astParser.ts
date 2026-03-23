/**
 * tailwind-styled-v4 — astParser
 *
 * UPGRADE RUST: oxc-parser (Rust-based, via napi-rs) menggantikan
 * hand-written bracket-counting tokenizer.
 *
 * Keuntungan oxc-parser:
 *  - ~10x lebih cepat dari tokenizer TypeScript
 *  - Handles semua edge case TypeScript/JS secara native
 *  - Same parser yang dipakai Rolldown, Vite 6, Biome
 *  - Zero maintenance — battle-tested di ekosistem besar
 *
 * Strategy: oxc-parser sebagai primary, tokenizer lama sebagai fallback.
 * Jika oxc gagal parse (malformed input), fallback transparan — zero breakage.
 *
 * Compatibility: Next.js, Vite, Rspack — semua fully supported.
 * oxc-parser adalah native Node addon (napi-rs), tidak ada WASM overhead.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedComponentConfig {
  base: string
  variants: Record<string, Record<string, string>>
  compounds: Array<{ class: string; [key: string]: any }>
  defaults: Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// oxc-parser — Rust AST walker (primary)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve key from Identifier or Literal node */
function oxcKey(node: any): string | null {
  if (!node) return null
  if (node.type === "Identifier") return node.name as string
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  return null
}

/** Resolve string value from Literal or no-expression TemplateLiteral */
function oxcStringVal(node: any): string | null {
  if (!node) return null
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  if (node.type === "TemplateLiteral" && node.expressions?.length === 0) {
    return (node.quasis as any[]).map((q: any) => q.value?.cooked ?? q.value?.raw ?? "").join("")
  }
  return null
}

/** Recursively walk ObjectExpression → plain Record */
function oxcWalkObject(node: any): Record<string, any> {
  const result: Record<string, any> = {}
  if (node?.type !== "ObjectExpression") return result

  for (const prop of node.properties ?? []) {
    if (prop.type !== "Property") continue
    const key = oxcKey(prop.key)
    if (!key) continue

    const val = prop.value
    const strVal = oxcStringVal(val)

    if (strVal !== null) {
      result[key] = strVal
    } else if (val?.type === "ObjectExpression") {
      result[key] = oxcWalkObject(val)
    } else if (val?.type === "ArrayExpression") {
      result[key] = (val.elements as any[])
        .filter((el: any) => el?.type === "ObjectExpression")
        .map((el: any) => oxcWalkObject(el))
    }
    // skip dynamic expressions, functions, computed props, etc.
  }
  return result
}

/**
 * Parse config object string using oxc-parser (Rust).
 * Wraps string sebagai valid statement agar oxc bisa parse.
 * Returns null jika parse gagal → fallback ke tokenizer.
 */
function parseWithOxc(objectStr: string): ParsedComponentConfig | null {
  let parseSync: (filename: string, source: string, options?: any) => any
  try {
    // Dynamic require agar tidak crash jika oxc-parser tidak terinstall
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    parseSync = require("oxc-parser").parseSync
  } catch {
    return null // oxc-parser not available → silently fallback
  }

  try {
    const source = `const __c = ${objectStr}`
    const { program, errors } = parseSync("config.ts", source, { sourceType: "script" })

    if (errors?.length > 0 || !program?.body?.[0]) return null

    const varDecl = program.body[0]
    if (varDecl.type !== "VariableDeclaration") return null

    const init = varDecl.declarations?.[0]?.init
    if (init?.type !== "ObjectExpression") return null

    const raw = oxcWalkObject(init)

    // ── base ────────────────────────────────────────────────────────────
    const base = typeof raw.base === "string" ? raw.base.trim() : ""

    // ── variants ─────────────────────────────────────────────────────────
    const variants: Record<string, Record<string, string>> = {}
    const rawVariants = raw.variants
    if (rawVariants && typeof rawVariants === "object" && !Array.isArray(rawVariants)) {
      for (const [vName, vMap] of Object.entries(rawVariants)) {
        if (vMap && typeof vMap === "object" && !Array.isArray(vMap)) {
          variants[vName] = {}
          for (const [vVal, cls] of Object.entries(vMap as Record<string, any>)) {
            if (typeof cls === "string") variants[vName][vVal] = cls.trim()
          }
        }
      }
    }

    // ── compoundVariants ─────────────────────────────────────────────────
    const compounds: Array<{ class: string; [key: string]: any }> = []
    const rawCompounds = raw.compoundVariants
    if (Array.isArray(rawCompounds)) {
      for (const item of rawCompounds) {
        if (item && typeof item.class === "string") {
          compounds.push(item as { class: string })
        }
      }
    }

    // ── defaultVariants ──────────────────────────────────────────────────
    const defaults: Record<string, string> = {}
    const rawDefaults = raw.defaultVariants
    if (rawDefaults && typeof rawDefaults === "object" && !Array.isArray(rawDefaults)) {
      for (const [k, v] of Object.entries(rawDefaults)) {
        if (typeof v === "string") defaults[k] = v
      }
    }

    return { base, variants, compounds, defaults }
  } catch {
    return null // parse error → fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer fallback (original implementation — preserved as-is)
// ─────────────────────────────────────────────────────────────────────────────

type TokenType =
  | "string"
  | "key"
  | "colon"
  | "comma"
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  | "other"

interface Token {
  type: TokenType
  value: string
  pos: number
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      let j = i + 1
      let str = ch
      while (j < src.length) {
        if (src[j] === "\\" && quote !== "`") {
          str += src[j] + src[j + 1]
          j += 2
          continue
        }
        if (src[j] === "\\" && quote === "`") {
          str += src[j] + src[j + 1]
          j += 2
          continue
        }
        str += src[j]
        if (src[j] === quote) {
          j++
          break
        }
        j++
      }
      tokens.push({ type: "string", value: str.slice(1, -1), pos: i })
      i = j
      continue
    }

    if (ch === ":") {
      tokens.push({ type: "colon", value: ":", pos: i })
      i++
      continue
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ",", pos: i })
      i++
      continue
    }
    if (ch === "{") {
      tokens.push({ type: "lbrace", value: "{", pos: i })
      i++
      continue
    }
    if (ch === "}") {
      tokens.push({ type: "rbrace", value: "}", pos: i })
      i++
      continue
    }
    if (ch === "[") {
      tokens.push({ type: "lbracket", value: "[", pos: i })
      i++
      continue
    }
    if (ch === "]") {
      tokens.push({ type: "rbracket", value: "]", pos: i })
      i++
      continue
    }

    if (/[\w$]/.test(ch)) {
      let j = i
      while (j < src.length && /[\w$]/.test(src[j])) j++
      tokens.push({ type: "key", value: src.slice(i, j), pos: i })
      i = j
      continue
    }

    tokens.push({ type: "other", value: ch, pos: i })
    i++
  }

  return tokens
}

interface ParsedObject {
  [key: string]: string | ParsedObject | Array<ParsedObject>
}

function parseObject(tokens: Token[], startIdx: number): { obj: ParsedObject; endIdx: number } {
  const obj: ParsedObject = {}
  let i = startIdx

  if (tokens[i]?.type !== "lbrace") return { obj, endIdx: i }
  i++

  while (i < tokens.length && tokens[i]?.type !== "rbrace") {
    if (tokens[i]?.type === "comma") {
      i++
      continue
    }

    let key: string | null = null
    if (tokens[i]?.type === "string") {
      key = tokens[i].value
      i++
    } else if (tokens[i]?.type === "key") {
      key = tokens[i].value
      i++
    } else {
      i++
      continue
    }

    if (tokens[i]?.type !== "colon") continue
    i++

    if (tokens[i]?.type === "lbrace") {
      const { obj: nested, endIdx } = parseObject(tokens, i)
      obj[key] = nested
      i = endIdx + 1
    } else if (tokens[i]?.type === "lbracket") {
      const { arr, endIdx } = parseArray(tokens, i)
      obj[key] = arr as any
      i = endIdx + 1
    } else if (tokens[i]?.type === "string") {
      obj[key] = tokens[i].value
      i++
    } else if (tokens[i]?.type === "key") {
      obj[key] = tokens[i].value
      i++
    } else {
      i++
    }
  }

  return { obj, endIdx: i }
}

function parseArray(tokens: Token[], startIdx: number): { arr: ParsedObject[]; endIdx: number } {
  const arr: ParsedObject[] = []
  let i = startIdx

  if (tokens[i]?.type !== "lbracket") return { arr, endIdx: i }
  i++

  while (i < tokens.length && tokens[i]?.type !== "rbracket") {
    if (tokens[i]?.type === "comma") {
      i++
      continue
    }
    if (tokens[i]?.type === "lbrace") {
      const { obj, endIdx } = parseObject(tokens, i)
      arr.push(obj)
      i = endIdx + 1
    } else {
      i++
    }
  }

  return { arr, endIdx: i }
}

function parseComponentConfigFallback(objectStr: string): ParsedComponentConfig {
  const tokens = tokenize(objectStr)
  const { obj } = parseObject(tokens, 0)

  const base = typeof obj.base === "string" ? obj.base.trim() : ""

  const variants: Record<string, Record<string, string>> = {}
  const rawVariants = obj.variants
  if (rawVariants && typeof rawVariants === "object" && !Array.isArray(rawVariants)) {
    for (const [variantName, variantValues] of Object.entries(rawVariants as ParsedObject)) {
      if (typeof variantValues === "object" && !Array.isArray(variantValues)) {
        variants[variantName] = {}
        for (const [valueName, cls] of Object.entries(variantValues as ParsedObject)) {
          if (typeof cls === "string") variants[variantName][valueName] = cls.trim()
        }
      }
    }
  }

  const compounds: Array<{ class: string; [key: string]: any }> = []
  const rawCompounds = obj.compoundVariants
  if (Array.isArray(rawCompounds)) {
    for (const item of rawCompounds as ParsedObject[]) {
      if (item && typeof item.class === "string") compounds.push(item as any)
    }
  }

  const defaults: Record<string, string> = {}
  const rawDefaults = obj.defaultVariants
  if (rawDefaults && typeof rawDefaults === "object" && !Array.isArray(rawDefaults)) {
    for (const [k, v] of Object.entries(rawDefaults as ParsedObject)) {
      if (typeof v === "string") defaults[k] = v
    }
  }

  return { base, variants, compounds, defaults }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — oxc-parser primary, tokenizer fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a ComponentConfig object literal string.
 *
 * PRIMARY:  oxc-parser (Rust, napi-rs) — ~10x faster, full TS/JS support.
 * FALLBACK: bracket-counting tokenizer — transparan, zero breakage.
 *
 * @example
 * parseComponentConfig(`{
 *   base: "px-4 py-2",
 *   variants: { size: { sm: "text-sm", lg: "text-lg" } },
 *   defaultVariants: { size: "sm" }
 * }`)
 */
export function parseComponentConfig(objectStr: string): ParsedComponentConfig {
  const oxcResult = parseWithOxc(objectStr)
  if (oxcResult !== null) return oxcResult

  // Fallback: original tokenizer
  return parseComponentConfigFallback(objectStr)
}
