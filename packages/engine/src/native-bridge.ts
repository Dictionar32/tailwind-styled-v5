/**
 * Engine — Rust native bridge
 */
import { createRequire } from "node:module"
import path from "node:path"

interface NativeEngineBinding {
  computeIncrementalDiff?: (
    previousJson: string,
    currentJson: string
  ) => {
    addedClasses: string[]
    removedClasses: string[]
    changedFiles: string[]
    unchangedFiles: number
  } | null
  hashFileContent?: (content: string) => string | null
  processFileChange?: (
    filepath: string,
    newClasses: string[],
    content: string | null
  ) => { added: string[]; removed: string[] } | null
}

let _binding: NativeEngineBinding | null | undefined

export function getNativeEngineBinding(): NativeEngineBinding | null {
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
      const mod = req(c) as NativeEngineBinding
      if (mod?.computeIncrementalDiff || mod?.processFileChange || mod?.hashFileContent) {
        return (_binding = mod)
      }
    } catch {
      /* next */
    }
  }
  return (_binding = null)
}
