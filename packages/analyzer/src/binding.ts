import {
  loadNativeBinding,
  resolveNativeBindingCandidates,
  resolveRuntimeDir,
} from "@tailwind-styled/shared"

import type { NativeAnalyzerBinding, NativeCssCompilerBinding } from "./types"
import { debugLog } from "./utils"

let bindingCache: NativeAnalyzerBinding | null | undefined
let bindingCandidateCache: string[] = []
let bindingLoadErrorsCache: Array<{ path: string; message: string }> = []
let loadedBindingPathCache: string | null = null

function isAnalyzerModule(module: unknown): module is NativeAnalyzerBinding {
  const candidate = module as Partial<NativeAnalyzerBinding> | null | undefined
  return typeof candidate?.analyzeClasses === "function"
}

export function getNativeBinding(): NativeAnalyzerBinding | null {
  if (bindingCache !== undefined) return bindingCache
  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    bindingCandidateCache = []
    bindingLoadErrorsCache = []
    loadedBindingPathCache = null
    debugLog("native binding disabled by TWS_NO_NATIVE/TWS_NO_RUST")
    bindingCache = null
    return bindingCache
  }

  const runtimeDir = resolveRuntimeDir(
    typeof __dirname === "string" ? __dirname : undefined,
    import.meta.url
  )
  const candidates = resolveNativeBindingCandidates({
    runtimeDir,
    envVarNames: ["TWS_NATIVE_PATH"],
  })

  const { binding, loadErrors, loadedPath } = loadNativeBinding<NativeAnalyzerBinding>({
    runtimeDir,
    candidates,
    isValid: isAnalyzerModule,
    invalidExportMessage: "Module loaded but missing `analyzeClasses` export.",
  })

  bindingCandidateCache = candidates
  bindingLoadErrorsCache = loadErrors
  loadedBindingPathCache = loadedPath

  if (binding) {
    debugLog(`native binding loaded from: ${loadedPath}`)
    bindingCache = binding
    return bindingCache
  }

  if (bindingLoadErrorsCache.length > 0) {
    debugLog(
      `native binding load failed for ${bindingLoadErrorsCache.length} candidate(s): ${bindingLoadErrorsCache
        .map((entry) => `${entry.path} (${entry.message})`)
        .join("; ")}`
    )
  } else {
    debugLog("native binding not found in any candidate path")
  }

  bindingCache = null
  return bindingCache
}

export function requireNativeBinding(): NativeAnalyzerBinding {
  const binding = getNativeBinding()
  if (binding?.analyzeClasses) return binding

  const lines = [
    "Native analyzer binding not found. Ensure `tailwind_styled_parser.node` is built.",
  ]

  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    lines.push("Native loading is disabled by TWS_NO_NATIVE/TWS_NO_RUST.")
  } else {
    lines.push("Checked paths:")
    for (const candidate of bindingCandidateCache) lines.push(`- ${candidate}`)
    if (bindingLoadErrorsCache.length > 0) {
      lines.push("Load errors:")
      for (const failure of bindingLoadErrorsCache) {
        lines.push(`- ${failure.path}: ${failure.message}`)
      }
    }
  }

  throw new Error(lines.join("\n"))
}

export function requireNativeCssCompiler(): NativeCssCompilerBinding {
  const binding = requireNativeBinding() as NativeCssCompilerBinding
  if (typeof binding.compileCss === "function") return binding

  const loadedPathText = loadedBindingPathCache ? ` (${loadedBindingPathCache})` : ""
  throw new Error(`Native analyzer compileCss binding is missing in v5${loadedPathText}.`)
}
