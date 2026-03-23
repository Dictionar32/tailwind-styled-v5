import {
  createDebugLogger,
  loadNativeBinding,
  resolveNativeBindingCandidates,
  resolveRuntimeDir,
} from "@tailwind-styled/shared"

import type { NativeAnimateBinding } from "./types"

let bindingPromise: Promise<NativeAnimateBinding> | null = null
const DEBUG_NAMESPACE = "tailwind-styled:animate"
const debugLog = createDebugLogger(DEBUG_NAMESPACE, "tailwind-styled/animate")

function isAnimateModule(module: unknown): module is NativeAnimateBinding {
  const candidate = module as Partial<NativeAnimateBinding> | null | undefined
  return (
    typeof candidate?.compileAnimation === "function" &&
    typeof candidate?.compileKeyframes === "function"
  )
}

function resolveBindingCandidates(runtimeDir: string): string[] {
  return resolveNativeBindingCandidates({
    runtimeDir,
    envVarNames: ["TWS_ANIMATE_NATIVE_PATH", "TWS_NATIVE_PATH"],
    enforceNodeExtensionForEnvPath: true,
  })
}

function loadAnimateBinding(): NativeAnimateBinding {
  if (process.env.TWS_NO_NATIVE === "1" || process.env.TWS_NO_RUST === "1") {
    throw new Error("Native animate backend is required in v5. TWS_NO_NATIVE/TWS_NO_RUST is not supported.")
  }

  const runtimeDir = resolveRuntimeDir(
    typeof __dirname === "string" ? __dirname : undefined,
    import.meta.url
  )
  const candidates = resolveBindingCandidates(runtimeDir)
  const { binding, loadErrors, loadedPath } = loadNativeBinding<NativeAnimateBinding>({
    runtimeDir,
    candidates,
    isValid: isAnimateModule,
    invalidExportMessage: "Module loaded but missing compileAnimation/compileKeyframes exports.",
  })

  if (binding) {
    debugLog(`native animate binding loaded from: ${loadedPath}`)
    return binding
  }

  if (loadErrors.length > 0) {
    debugLog(
      `native animate binding load failed for ${loadErrors.length} candidate(s): ${loadErrors
        .map((entry) => `${entry.path} (${entry.message})`)
        .join("; ")}`
    )
  } else {
    debugLog("native animate binding not found in any candidate path")
  }

  const lines = [
    "Native animate backend not found. Ensure `tailwind_styled_parser.node` is built.",
    "Checked paths:",
    ...candidates.map((candidate) => `- ${candidate}`),
  ]
  if (loadErrors.length > 0) {
    lines.push("Load errors:")
    for (const error of loadErrors) lines.push(`- ${error.path}: ${error.message}`)
  }
  throw new Error(lines.join("\n"))
}

export async function getAnimateBinding(): Promise<NativeAnimateBinding> {
  if (!bindingPromise) {
    bindingPromise = Promise.resolve().then(loadAnimateBinding)
  }
  return bindingPromise
}

export async function initAnimate(): Promise<void> {
  await getAnimateBinding()
}
