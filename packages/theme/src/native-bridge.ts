/**
 * Theme — Rust native bridge
 */
import { createRequire } from "node:module"
import path from "node:path"

interface NativeThemeBinding {
  compileTheme?: (
    tokensJson: string,
    themeName: string,
    prefix: string
  ) => {
    name: string
    selector: string
    css: string
    tokens: Array<{ key: string; cssVar: string; value: string }>
  } | null
  extractCssVars?: (source: string) => string[] | null
}

let _binding: NativeThemeBinding | null | undefined

export function getNativeThemeBinding(): NativeThemeBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    return (_binding = null)
  }
  const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd()
  const req =
    typeof require === "function" ? require : createRequire(path.join(runtimeDir, "noop.cjs"))
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(runtimeDir, "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeThemeBinding
      if (mod?.compileTheme) return (_binding = mod)
    } catch {
      /* next */
    }
  }
  return (_binding = null)
}
