/**
 * Rust-backed CSS compiler and AST extractor bridge.
 * Wraps compile_css and ast_extract_classes N-API functions.
 */
import path from "node:path"
import { createRequire } from "node:module"

interface NativeCompilerBinding {
  compileCss?: (
    classes: string[],
    prefix: string | null
  ) => {
    css: string
    resolvedClasses: string[]
    unknownClasses: string[]
    sizeBytes: number
  }
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

let _binding: NativeCompilerBinding | null | undefined

/**
 * Get the CSS compiler binding - THROWS if unavailable.
 * 
 * v5 CHANGE: Previously returned null and fell back to JS pipeline.
 * Now throws an error to ensure native binding is always used.
 * 
 * @throws Error if native binding is not available
 */
function getBinding(): NativeCompilerBinding {
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
    path.resolve(__dirname, "..", "..", "..", "native", "tailwind_styled_parser.node"),
    path.resolve(__dirname, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeCompilerBinding
      if (mod?.compileCss) {
        _binding = mod
        return _binding
      }
    } catch {
      /* try next */
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
  css: string
  resolvedClasses: string[]
  unknownClasses: string[]
  sizeBytes: number
  engine: "rust" | "fallback"
}

export interface AstExtractResult {
  classes: string[]
  componentNames: string[]
  hasTwUsage: boolean
  hasUseClient: boolean
  imports: string[]
  engine: "rust" | "fallback"
}

/**
 * Compile Tailwind class list → atomic CSS via Rust LightningCSS-style compiler.
 * 
 * v5 CHANGE: Now THROWS if native binding is unavailable.
 * Previously fell back to JS implementation.
 * 
 * @throws Error if native binding is not available
 */
export function compileCssNative(
  classes: string[],
  prefix: string | null = null
): CssCompileResult {
  const binding = getBinding() // throws if unavailable
  // v5: Binding is guaranteed to have compileCss after getBinding() returns
  const r = binding.compileCss!(classes, prefix)
  return { ...r, engine: "rust" }
}

/**
 * Extract Tailwind classes from source via Rust AST-style extractor.
 * 
 * v5 CHANGE: Now THROWS if native binding is unavailable.
 * Previously fell back to JS implementation.
 * 
 * @throws Error if native binding is not available
 */
export function astExtractClassesNative(source: string, filename: string): AstExtractResult {
  const binding = getBinding() // throws if unavailable
  // v5: Binding is guaranteed to have astExtractClasses after getBinding() returns
  const r = binding.astExtractClasses!(source, filename)
  return { ...r, engine: "rust" }
}
