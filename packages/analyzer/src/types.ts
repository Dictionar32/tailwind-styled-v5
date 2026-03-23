import type { ScanWorkspaceOptions, ScanWorkspaceResult } from "@tailwind-styled/scanner"

export interface NativeAnalyzerBinding {
  analyzeClasses: (filesJson: string, root: string, topN: number) => NativeReport | null
  compileCss?: (classes: string[], prefix: string | null) => NativeCssCompileResult | null
}

export interface NativeCssCompilerBinding extends NativeAnalyzerBinding {
  compileCss: (classes: string[], prefix: string | null) => NativeCssCompileResult | null
}

export interface NativeReport {
  root: string
  totalFiles: number
  uniqueClassCount: number
  totalClassOccurrences: number
  topClasses: Array<{ name: string; count: number }>
  duplicateCandidates: Array<{ name: string; count: number }>
  safelist: string[]
}

export interface NativeCssCompileResult {
  css: string
  resolvedClasses: string[]
  unknownClasses: string[]
  sizeBytes: number
}

export interface ClassUsage {
  name: string
  count: number
  isUnused?: boolean
  isConflict?: boolean
}

export interface ClassConflict {
  className: string
  variants: string[]
  classes: string[]
  message: string
}

export interface AnalyzerSemanticReport {
  unusedClasses: ClassUsage[]
  unknownClasses: ClassUsage[]
  conflicts: ClassConflict[]
  tailwindConfig?: {
    path: string
    loaded: boolean
    safelistCount: number
    customUtilityCount: number
    warning?: string
  }
}

export interface AnalyzerReport {
  root: string
  totalFiles: number
  uniqueClassCount: number
  totalClassOccurrences: number
  classStats: {
    all: ClassUsage[]
    top: ClassUsage[]
    frequent: ClassUsage[]
    unique: ClassUsage[]
    distribution: Record<string, number>
  }
  /** All classes found, useful for Tailwind safelist. */
  safelist: string[]
  semantic?: AnalyzerSemanticReport
}

export interface AnalyzerOptions {
  scanner?: ScanWorkspaceOptions
  classStats?: {
    top?: number
    frequentThreshold?: number
  }
  /**
   * Enable semantic reporting. Provide `tailwindConfigPath` to override config lookup.
   * Relative paths are resolved from `root` in `analyzeWorkspace`.
   */
  semantic?: boolean | { tailwindConfigPath?: string }
  includeClass?: (className: string) => boolean
}

export interface ClassToCssOptions {
  prefix?: string | null
  strict?: boolean
}

export interface ClassToCssResult {
  inputClasses: string[]
  css: string
  declarations: string
  resolvedClasses: string[]
  unknownClasses: string[]
  sizeBytes: number
}

export interface LoadedTailwindConfig {
  path: string
  loaded: boolean
  warning?: string
  safelist: Set<string>
  customUtilities: Set<string>
}

export interface TailwindConfigCacheEntry {
  mtimeMs: number
  size: number
  config: LoadedTailwindConfig
}

export type { ScanWorkspaceResult }
