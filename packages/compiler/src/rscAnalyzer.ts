/**
 * tailwind-styled-v4 — RSC Analyzer
 *
 * Inti dari RSC-Aware upgrade.
 * Menganalisis setiap file untuk menentukan:
 * - Server Component atau Client Component
 * - Variant mana yang bisa di-resolve di server
 * - Class mana yang membutuhkan client runtime
 * - Auto client boundary injection
 *
 * Hasilnya:
 * - Server Component → pure static className, zero JS ke client
 * - Client Component → tetap seperti biasa dengan lookup table
 */

// ─────────────────────────────────────────────────────────────────────────────
// RSC Analysis Types
// ─────────────────────────────────────────────────────────────────────────────

export type ComponentEnv = "server" | "client" | "auto"

export interface RscAnalysis {
  /** File ini adalah server component */
  isServer: boolean
  /** File ini butuh "use client" directive */
  needsClientDirective: boolean
  /** Alasan butuh client */
  clientReasons: string[]
  /** Classes yang membutuhkan client interaction */
  interactiveClasses: string[]
  /** Apakah semua variants bisa di-resolve statically di server */
  canStaticResolveVariants: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive class patterns — butuh client-side event handling
// ─────────────────────────────────────────────────────────────────────────────

/** CSS classes yang TIDAK butuh JS — tetap bisa di server */
const CSS_INTERACTIVE_OK = [
  /^hover:/, // CSS :hover — no JS needed
  /^focus:/, // CSS :focus — no JS needed
  /^focus-within:/, // CSS :focus-within
  /^focus-visible:/, // CSS :focus-visible
  /^active:/, // CSS :active
  /^group-hover:/, // Tailwind group variant — CSS only
  /^group-focus:/, // CSS only
  /^peer-/, // Tailwind peer — CSS only
  /^first:/, // CSS :first-child
  /^last:/, // CSS :last-child
  /^odd:/, // CSS :nth-child(odd)
  /^even:/, // CSS :nth-child(even)
  /^disabled:/, // CSS :disabled
  /^placeholder:/, // CSS ::placeholder
  /^dark:/, // CSS @media prefers-color-scheme
  /^print:/, // CSS @media print
  /^md:|^sm:|^lg:|^xl:|^2xl:/, // Responsive breakpoints — CSS only
]

/** Patterns yang BENAR-BENAR butuh JS runtime */
const REQUIRES_JS_PATTERNS = [
  // React hooks
  /\buseState\b/,
  /\buseEffect\b/,
  /\buseRef\b/,
  /\buseCallback\b/,
  /\buseMemo\b/,
  /\buseReducer\b/,
  /\buseContext\b/,
  // Event handlers
  /\bon[A-Z][a-zA-Z]+\s*[=:]/, // onClick=, onMouseEnter:, etc.
  // Browser APIs
  /\bwindow\./,
  /\bdocument\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  // Dynamic imports
  /import\s*\(/,
]

// ─────────────────────────────────────────────────────────────────────────────
// Main analyzer
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeFile(source: string, _filename = ""): RscAnalysis {
  const clientReasons: string[] = []
  const interactiveClasses: string[] = []

  // 1. Explicit "use client" directive
  const hasClientDirective =
    source.trimStart().startsWith('"use client"') || source.trimStart().startsWith("'use client'")

  if (hasClientDirective) {
    clientReasons.push("explicit 'use client' directive")
  }

  // 2. React hooks → needs client
  for (const pattern of REQUIRES_JS_PATTERNS) {
    if (pattern.test(source)) {
      const match = source.match(pattern)
      if (match) clientReasons.push(`uses ${match[0].trim()}`)
    }
  }

  // 3. Check for tw.server.* usage — force server
  const hasServerMarker = source.includes("tw.server.")

  // 4. Collect interactive classes from tw templates
  const templateRe = /\btw\.(?:server\.)?(\w+)`((?:[^`\\]|\\.)*)`/g
  const _objectRe = /\btw\.(?:server\.)?(\w+)\(\s*(\{[\s\S]*?\})\s*\)/g
  let m: RegExpExecArray | null

  while ((m = templateRe.exec(source)) !== null) {
    const classes = m[2]
    // CSS-only interaction is fine for server, skip
    // But collect them for reference
    const parts = classes.split(/\s+/).filter(Boolean)
    for (const cls of parts) {
      const isOk = CSS_INTERACTIVE_OK.some((re) => re.test(cls))
      if (!isOk && /^[a-z-]+:/.test(cls)) {
        interactiveClasses.push(cls)
        clientReasons.push(`uses JS-interactive class: ${cls}`)
      }
    }
  }

  const needsClientDirective = !hasServerMarker && (hasClientDirective || clientReasons.length > 0)

  const isServer = !needsClientDirective || hasServerMarker

  return {
    isServer,
    needsClientDirective,
    clientReasons: [...new Set(clientReasons)],
    interactiveClasses: [...new Set(interactiveClasses)],
    canStaticResolveVariants: isServer,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side static variant resolution
//
// Ketika sebuah file adalah server component dan variant value diketahui
// di compile time (literal string), compiler bisa langsung inline className.
// ─────────────────────────────────────────────────────────────────────────────

export interface StaticVariantUsage {
  /** Variant prop values yang ditemukan di JSX — bisa di-resolve di server */
  resolved: Record<string, string>
  /** Variant props yang dinamis — butuh runtime */
  dynamic: string[]
}

/**
 * Deteksi penggunaan variant dalam JSX:
 * <Button variant="primary"/> → dapat di-resolve statically
 * <Button variant={userVariant}/> → dinamis, butuh runtime
 */
export function analyzeVariantUsage(
  source: string,
  componentName: string,
  variantKeys: string[]
): StaticVariantUsage {
  const resolved: Record<string, string> = {}
  const dynamic: string[] = []

  for (const key of variantKeys) {
    // Static: variant="primary"
    const staticRe = new RegExp(`<${componentName}[^>]*\\b${key}=["']([^"']+)["'][^>]*>`, "g")
    // Dynamic: variant={someVar}
    const dynamicRe = new RegExp(`<${componentName}[^>]*\\b${key}=\\{[^"'][^}]*\\}[^>]*>`, "g")

    const staticMatch = source.match(staticRe)
    const dynamicMatch = source.match(dynamicRe)

    if (dynamicMatch) {
      dynamic.push(key)
    } else if (staticMatch) {
      const valMatch = staticMatch[0].match(new RegExp(`${key}=["']([^"']+)["']`))
      if (valMatch) resolved[key] = valMatch[1]
    }
  }

  return { resolved, dynamic }
}

/**
 * Untuk server component dengan variant usage statically known,
 * resolve langsung ke className string — nol runtime.
 *
 * Input:
 *   base = "px-4 py-2"
 *   table = { variant: { primary: "px-4 py-2 bg-blue-500" } }
 *   resolved = { variant: "primary" }
 *
 * Output:
 *   "px-4 py-2 bg-blue-500"  ← langsung inline di server
 */
export function resolveServerVariant(
  base: string,
  table: Record<string, Record<string, string>>,
  defaults: Record<string, string>,
  resolved: Record<string, string>
): string {
  const parts: string[] = [base]

  for (const key in table) {
    const val = resolved[key] ?? defaults[key]
    if (val && table[key][val]) {
      parts.push(table[key][val])
    }
  }

  // Dedupe dengan last-wins
  const seen = new Map<string, string>()
  for (const part of parts) {
    for (const cls of part.split(/\s+/).filter(Boolean)) {
      const prefix = cls.replace(/^(?:[\w-]+:)*/, "").split("-")[0]
      seen.set(prefix, cls)
    }
  }

  return Array.from(seen.values()).join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Client boundary auto-injection helpers
// ─────────────────────────────────────────────────────────────────────────────

export function injectClientDirective(code: string): string {
  if (code.startsWith('"use client"') || code.startsWith("'use client'")) {
    return code
  }
  return `"use client";\n${code}`
}

export function injectServerOnlyComment(code: string): string {
  // Hint untuk bundler — RSC optimizer bisa tree-shake client deps
  return `/* @tw-server-only */\n${code}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 7 — Public API for auto-inject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect if a file needs "use client" directive injected.
 * Used by webpackLoader + turbopackLoader for RSC auto-inject.
 */
export function detectRSCBoundary(code: string): boolean {
  const analysis = analyzeFile(code)
  return analysis.needsClientDirective
}

/**
 * Auto-inject "use client" if file uses interactive patterns.
 * Idempotent — safe to call multiple times.
 */
export function autoInjectClientBoundary(
  code: string,
  filepath = ""
): {
  code: string
  injected: boolean
  reasons: string[]
} {
  const analysis = analyzeFile(code, filepath)
  if (analysis.needsClientDirective) {
    return {
      code: injectClientDirective(code),
      injected: true,
      reasons: analysis.clientReasons,
    }
  }
  return { code, injected: false, reasons: [] }
}
