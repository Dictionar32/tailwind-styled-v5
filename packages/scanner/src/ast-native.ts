/**
 * tailwind-styled-v4 — AST-native class extractor (Rust-backed)
 *
 * Replaces ast-parser.ts with Rust implementation.
 * Uses ast_extract_classes() N-API function.
 */

import path from "node:path"
import { createRequire } from "node:module"

// ── Native binding ────────────────────────────────────────────────────────────

interface NativeAstBinding {
  astExtractClasses?: (
    source: string,
    filename: string
  ) => {
    classes: string[]
    componentNames: string[]
    hasTwUsage: boolean
    hasUseClient: boolean
    imports: string[]
  }
}

let _binding: NativeAstBinding | null | undefined

function getBinding(): NativeAstBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1") return (_binding = null)

  const req = typeof require === "function" ? require : createRequire(import.meta.url)
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(__dirname, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeAstBinding
      if (mod?.astExtractClasses) return (_binding = mod)
    } catch {
      /* next */
    }
  }
  return (_binding = null)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AstExtractResult {
  classes: string[]
  componentNames: string[]
  hasTwUsage: boolean
  hasUseClient: boolean
  imports: string[]
  engine: "rust" | "fallback" | "oxc"
}

/**
 * Extract Tailwind classes using AST-level analysis.
 * More accurate than pure regex — handles JSX, template literals, object configs.
 *
 * Uses Rust engine when native binary is available.
 */
export function astExtractClasses(source: string, filename: string): AstExtractResult {
  const binding = getBinding()

  if (binding?.astExtractClasses) {
    const r = binding.astExtractClasses(source, filename)
    return {
      classes: r.classes,
      componentNames: r.componentNames,
      hasTwUsage: r.hasTwUsage,
      hasUseClient: r.hasUseClient,
      imports: r.imports,
      engine: "rust",
    }
  }

  // JS fallback — basic regex extraction
  const classes = new Set<string>()
  const componentNames: string[] = []

  // tw.tag`classes`
  const twTpl = /\btw(?:\.server)?\.(\w+)`([^`]*)`/g
  let m: RegExpExecArray | null
  while ((m = twTpl.exec(source)) !== null) {
    if (!m[2].includes("${")) {
      m[2]
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => classes.add(c))
    }
  }

  // base: "..."
  const baseRe = /base\s*:\s*["'`]([^"'`]+)["'`]/g
  while ((m = baseRe.exec(source)) !== null) {
    m[1]
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => classes.add(c))
  }

  // className="..."
  const classRe = /className=["']([^"']+)["']/g
  while ((m = classRe.exec(source)) !== null) {
    m[1]
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => classes.add(c))
  }

  // component names
  const compRe = /(?:const|let)\s+(\w+)\s*=\s*tw/g
  while ((m = compRe.exec(source)) !== null) componentNames.push(m[1])

  // imports
  const imports: string[] = []
  const importRe = /from\s+["']([^"']+)["']/g
  while ((m = importRe.exec(source)) !== null) imports.push(m[1])

  return {
    classes: Array.from(classes).filter(
      (c) => c.includes("-") || c.includes(":") || c.includes("[")
    ),
    componentNames,
    hasTwUsage: source.includes("tw.") || source.includes('from "tailwind-styled'),
    hasUseClient: source.includes('"use client"') || source.includes("'use client'"),
    imports,
    engine: "fallback",
  }
}
