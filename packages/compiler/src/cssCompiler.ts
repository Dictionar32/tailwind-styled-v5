/**
 * tailwind-styled-v4 — CSS Compiler (Rust-backed LightningCSS-style)
 *
 * v5 CHANGE: Now requires native binding. Previously fell back to JS implementation.
 *
 * Compiles Tailwind class lists to atomic CSS using Rust native engine.
 */

import path from "node:path"
import { createRequire } from "node:module"

// ── Native binding ────────────────────────────────────────────────────────────

interface NativeCssBinding {
  compileCss?: (
    classes: string[],
    prefix: string | null
  ) => {
    css: string
    resolvedClasses: string[]
    unknownClasses: string[]
    sizeBytes: number
  }
}

let _binding: NativeCssBinding | null | undefined

/**
 * Get the CSS compiler binding - THROWS if unavailable.
 * 
 * v5 CHANGE: Previously returned null and fell back to JS pipeline.
 * Now throws an error to ensure native binding is always used.
 * 
 * @throws Error if native binding is not available
 */
function getBinding(): NativeCssBinding {
  if (_binding !== undefined) {
    if (_binding === null) {
      throw new Error(
        `[tailwind-styled/compiler v5] Native CSS binding is required but not available.\n` +
        `Please ensure the native module is properly built.`
      )
    }
    return _binding
  }
  
  if (process.env.TWS_NO_NATIVE === "1") {
    _binding = null
    throw new Error(
      `[tailwind-styled/compiler v5] Native binding is required.\n` +
      `The TWS_NO_NATIVE environment variable is set, which disables native binding.`
    )
  }

  const req = typeof require === "function" ? require : createRequire(import.meta.url)
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(__dirname, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeCssBinding
      if (mod?.compileCss) {
        _binding = mod
        return _binding
      }
    } catch {
      /* next */
    }
  }
  
  // v5: Throw error instead of returning null
  _binding = null
  throw new Error(
    `[tailwind-styled/compiler v5] Native CSS binding not found.\n` +
    `Tried loading from:\n` +
    candidates.map((c) => `  - ${c}`).join("\n") + `\n` +
    `\n` +
    `Please build the native module.`
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CssCompileResult {
  /** Generated atomic CSS */
  css: string
  /** Classes successfully resolved to native CSS */
  resolvedClasses: string[]
  /** Classes with no native mapping (get @apply fallback) */
  unknownClasses: string[]
  /** Byte size of generated CSS */
  sizeBytes: number
  /** Which engine produced this output */
  engine: "rust" | "fallback"
}

/**
 * Compile a list of Tailwind classes into atomic CSS.
 *
 * v5 CHANGE: Now THROWS if native binding is unavailable.
 * Previously fell back to JS implementation.
 *
 * Uses Rust LightningCSS-style engine when native binary is available.
 *
 * @example
 * const { css } = compileCssFromClasses(['flex', 'items-center', 'hover:bg-blue-600'])
 * // → ".flex { display: flex } .items-center { align-items: center } ..."
 * 
 * @throws Error if native binding is not available
 */
export function compileCssFromClasses(
  classes: string[],
  options: { prefix?: string } = {}
): CssCompileResult {
  const binding = getBinding() // throws if unavailable
  const prefix = options.prefix ?? null

  // v5: Binding is guaranteed to have compileCss after getBinding() returns
  const r = binding.compileCss!(classes, prefix)
  return {
    css: r.css,
    resolvedClasses: r.resolvedClasses,
    unknownClasses: r.unknownClasses,
    sizeBytes: r.sizeBytes,
    engine: "rust",
  }
}

/**
 * Compile CSS for a set of classes and inject as a <style> block (SSR helper).
 */
export function buildStyleTag(classes: string[]): string {
  const { css } = compileCssFromClasses(classes)
  return css ? `<style data-tailwind-styled>${css}</style>` : ""
}
