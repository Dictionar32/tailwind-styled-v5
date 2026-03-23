import { requireNativeCssCompiler } from "./binding"
import type { ClassToCssOptions, ClassToCssResult, NativeCssCompileResult } from "./types"
import { formatErrorMessage } from "./utils"

export function normalizeClassInput(input: string | string[]): string[] {
  if (typeof input === "string") {
    return input
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  if (!Array.isArray(input)) {
    throw new TypeError("classToCss input must be a string or an array of strings.")
  }

  const out: string[] = []
  for (const item of input) {
    if (typeof item !== "string") {
      throw new TypeError("classToCss input array must contain only strings.")
    }
    const value = item.trim()
    if (value.length > 0) out.push(value)
  }
  return out
}

function normalizeClassToCssOptions(options: ClassToCssOptions): {
  prefix: string | null
  strict: boolean
} {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("classToCss options must be an object.")
  }

  const strict = options.strict ?? false
  if (typeof strict !== "boolean") {
    throw new TypeError("classToCss options.strict must be a boolean when provided.")
  }

  const prefix = options.prefix ?? null
  if (prefix !== null && typeof prefix !== "string") {
    throw new TypeError("classToCss options.prefix must be a string or null when provided.")
  }

  return { prefix, strict }
}

function mergeDeclarationMap(target: Map<string, string>, css: string): void {
  const ruleRegex = /\{([^}]*)\}/g
  let ruleMatch = ruleRegex.exec(css)
  while (ruleMatch) {
    const body = ruleMatch[1]
    for (const raw of body.split(";")) {
      const declaration = raw.trim()
      if (declaration.length === 0) continue
      const colonIndex = declaration.indexOf(":")
      if (colonIndex <= 0) continue
      const property = declaration.slice(0, colonIndex).trim()
      const value = declaration.slice(colonIndex + 1).trim()
      if (property.length === 0 || value.length === 0) continue
      if (target.has(property)) target.delete(property)
      target.set(property, value)
    }
    ruleMatch = ruleRegex.exec(css)
  }
}

function declarationMapToString(declarationMap: Map<string, string>): string {
  return Array.from(declarationMap.entries())
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ")
}

/**
 * Convert Tailwind class input into atomic CSS output via native binding.
 * @example
 * const css = await classToCss("opacity-0 translate-y-2", { strict: true })
 */
export async function classToCss(
  input: string | string[],
  options: ClassToCssOptions = {}
): Promise<ClassToCssResult> {
  const inputClasses = normalizeClassInput(input)
  const normalizedOptions = normalizeClassToCssOptions(options)
  if (inputClasses.length === 0) {
    return {
      inputClasses: [],
      css: "",
      declarations: "",
      resolvedClasses: [],
      unknownClasses: [],
      sizeBytes: 0,
    }
  }

  const binding = requireNativeCssCompiler()
  const prefix = normalizedOptions.prefix
  const cssChunks: string[] = []
  const resolvedClasses: string[] = []
  const unknownClasses: string[] = []
  let sizeBytes = 0
  const declarationMap = new Map<string, string>()

  for (const className of inputClasses) {
    let compiled: NativeCssCompileResult | null = null
    try {
      compiled = binding.compileCss([className], prefix)
    } catch (error) {
      throw new Error(
        `Native analyzer failed while compiling class "${className}": ${formatErrorMessage(error)}`,
        { cause: error }
      )
    }

    if (!compiled) {
      throw new Error(`Native analyzer returned no result for class "${className}".`)
    }

    cssChunks.push(compiled.css)
    resolvedClasses.push(...compiled.resolvedClasses)
    unknownClasses.push(...compiled.unknownClasses)
    sizeBytes += compiled.sizeBytes
    mergeDeclarationMap(declarationMap, compiled.css)
  }

  const uniqueUnknown = Array.from(new Set(unknownClasses))
  if (normalizedOptions.strict && uniqueUnknown.length > 0) {
    throw new Error(`Unknown Tailwind classes: ${uniqueUnknown.join(", ")}`)
  }

  return {
    inputClasses,
    css: cssChunks.filter((chunk) => chunk.length > 0).join("\n"),
    declarations: declarationMapToString(declarationMap),
    resolvedClasses: Array.from(new Set(resolvedClasses)),
    unknownClasses: uniqueUnknown,
    sizeBytes,
  }
}
