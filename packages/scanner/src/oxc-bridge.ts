/**
 * tailwind-styled-v4 — Oxc AST bridge untuk scanner.
 *
 * Mengekspos oxcExtractClasses sebagai pengganti astExtractClasses
 * yang berbasis regex. Lebih akurat karena pakai real AST parser.
 */

import path from "node:path"
import { createRequire } from "node:module"
import type { AstExtractResult } from "./ast-native"

interface NativeOxcBinding {
  oxcExtractClasses?: (
    source: string,
    filename: string
  ) => {
    classes: string[]
    componentNames: string[]
    hasTwUsage: boolean
    hasUseClient: boolean
    imports: string[]
    engine: string
  }
}

let _binding: NativeOxcBinding | null | undefined

function getBinding(): NativeOxcBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1") return (_binding = null)

  const req = typeof require === "function" ? require : createRequire(import.meta.url)
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(__dirname, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeOxcBinding
      if (mod?.oxcExtractClasses) return (_binding = mod)
    } catch {
      /* next */
    }
  }
  return (_binding = null)
}

/**
 * Ekstrak kelas Tailwind menggunakan Oxc AST parser (Rust).
 * Lebih akurat dari regex — memahami JSX, TypeScript, template literals.
 *
 * Mengembalikan format yang sama dengan astExtractClasses untuk kompatibilitas.
 */
export function oxcExtractClasses(source: string, filename: string): AstExtractResult {
  const binding = getBinding()

  if (binding?.oxcExtractClasses) {
    const r = binding.oxcExtractClasses(source, filename)
    return {
      classes: r.classes,
      componentNames: r.componentNames,
      hasTwUsage: r.hasTwUsage,
      hasUseClient: r.hasUseClient,
      imports: r.imports,
      engine: "oxc" as const,
    }
  }

  // Fallback ke regex-based ast-native
  const { astExtractClasses } = require("./ast-native")
  return astExtractClasses(source, filename)
}
