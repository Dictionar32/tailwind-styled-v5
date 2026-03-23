import fs from "node:fs"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"

import { extractAllClasses } from "@tailwind-styled/compiler"

import { ScanCache } from "./cache"
import { SmartCache } from "./smart-cache"
import { parseJsxLikeClasses } from "./ast-parser"
import { scanWorkspaceNative, extractClassesNative, hashContentNative } from "./native-bridge"
import { readCache, writeCache, filePriority, type NativeCacheEntry } from "./cache-native"
import { isRustCacheAvailable } from "./rust-cache-bridge"
import { createLogger } from "@tailwind-styled/shared"

const log = createLogger("scanner")

const SCAN_WORKER_TIMEOUT_MS = 120_000
const SCAN_WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require("node:worker_threads")
try {
  const scanner = require(workerData.modulePath)
  const result = scanner.scanWorkspace(workerData.rootDir, workerData.options ?? {})
  parentPort.postMessage({ ok: true, result })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })
}
`

type NativeParsedClass = { raw?: string }
type NativeParserBinding = { parse_classes?: (input: string) => NativeParsedClass[] }

let nativeParserBinding: NativeParserBinding | null | undefined
let nativeParserInitError: string | null = null

function canUseCjsRequire(): boolean {
  return typeof require === "function"
}

function debugNative(message: string): void {
  log.debug(`[native] ${message}`)
}

function loadNativeParserBinding(): NativeParserBinding | null {
  if (nativeParserBinding !== undefined) return nativeParserBinding

  if (!canUseCjsRequire()) {
    nativeParserBinding = null
    nativeParserInitError = "require is unavailable in current module format"
    debugNative(`fallback to JS: ${nativeParserInitError}`)
    return nativeParserBinding
  }

  const candidates = [
    path.resolve(process.cwd(), "native/tailwind_styled_parser.node"),
    path.resolve(process.cwd(), "native/build/Release/tailwind_styled_parser.node"),
  ]

  for (const fullPath of candidates) {
    if (!fs.existsSync(fullPath)) continue
    try {
      const required = require(fullPath) as NativeParserBinding
      if (required && typeof required.parse_classes === "function") {
        nativeParserBinding = required
        debugNative(`using native parser from ${fullPath}`)
        return nativeParserBinding
      }
    } catch (error) {
      nativeParserInitError = error instanceof Error ? error.message : String(error)
    }
  }

  nativeParserBinding = null
  if (!nativeParserInitError) {
    nativeParserInitError = "native .node binding not found"
  }
  debugNative(`fallback to JS: ${nativeParserInitError}`)
  return nativeParserBinding
}

function normalizeWithNativeParser(tokens: string[]): string[] | null {
  const binding = loadNativeParserBinding()
  if (!binding || typeof binding.parse_classes !== "function") return null

  try {
    const parsed = binding.parse_classes(tokens.join(" "))
    const normalized = parsed.map((item) => item.raw?.trim() ?? "").filter(Boolean)
    return Array.from(new Set(normalized))
  } catch (error) {
    nativeParserInitError = error instanceof Error ? error.message : String(error)
    debugNative(`runtime error, fallback to JS: ${nativeParserInitError}`)
    return null
  }
}

export interface ScanWorkspaceOptions {
  includeExtensions?: string[]
  ignoreDirectories?: string[]
  useCache?: boolean
  cacheDir?: string
  smartInvalidation?: boolean
}

export interface ScanFileResult {
  file: string
  classes: string[]
}

export interface ScanWorkspaceResult {
  files: ScanFileResult[]
  totalFiles: number
  uniqueClasses: string[]
}

export const DEFAULT_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]
export const DEFAULT_IGNORES = ["node_modules", ".git", ".next", "dist", "out", ".turbo", ".cache"]

function resolveScannerWorkerModulePath(): string | null {
  const runtimeDir =
    typeof __dirname === "string" && __dirname.length > 0
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url))

  const candidates = [
    path.resolve(runtimeDir, "index.cjs"),
    path.resolve(runtimeDir, "index.js"),
    path.resolve(runtimeDir, "index.ts"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

function scanWorkspaceInWorker(
  rootDir: string,
  options: ScanWorkspaceOptions
): Promise<ScanWorkspaceResult> {
  const modulePath = resolveScannerWorkerModulePath()
  if (!modulePath) {
    return Promise.reject(new Error("scanner worker module path could not be resolved"))
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const worker = new Worker(SCAN_WORKER_BOOTSTRAP, {
      eval: true,
      workerData: { modulePath, rootDir, options },
    })

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new Error(`scanner worker timed out after ${SCAN_WORKER_TIMEOUT_MS}ms`))
    }, SCAN_WORKER_TIMEOUT_MS)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    worker.once("message", (payload: unknown) => {
      const message = payload as
        | { ok: true; result: ScanWorkspaceResult }
        | { ok: false; error?: string }
      finish(() => {
        if (message?.ok) {
          resolve(message.result)
          return
        }
        reject(new Error(message?.error ?? "scanner worker failed without an error message"))
      })
    })

    worker.once("error", (error) => {
      finish(() => reject(error))
    })

    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`scanner worker exited with code ${code}`)))
      }
    })
  })
}

function buildExtensionSet(includeExtensions: string[]): Set<string> {
  return new Set(includeExtensions)
}

function collectCandidates(
  rootDir: string,
  ignoreDirectories: Set<string>,
  extensionSet: Set<string>
): string[] {
  const candidates: string[] = []
  const directories = [rootDir]

  while (directories.length > 0) {
    const currentDir = directories.pop()
    if (!currentDir) continue

    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (!ignoreDirectories.has(entry.name)) directories.push(fullPath)
        continue
      }

      if (!entry.isFile()) continue
      if (!extensionSet.has(path.extname(entry.name))) continue
      candidates.push(fullPath)
    }
  }

  return candidates
}

function hashContentFallback(content: string): string {
  let h = 5381
  for (let i = 0; i < content.length; i += 1) {
    h = ((h << 5) + h + content.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

function toCacheSize(size: number): number {
  if (!Number.isFinite(size)) return 0
  const normalized = Math.max(0, Math.trunc(size))
  return Math.min(normalized, 0xffffffff)
}

export function scanSource(source: string): string[] {
  // Try Rust engine first — fastest path
  const nativeClasses = extractClassesNative(source)
  if (nativeClasses) return nativeClasses

  // JS fallback
  const baseClasses = extractAllClasses(source)
  let jsxClasses: string[] = []
  try {
    jsxClasses = parseJsxLikeClasses(source)
  } catch {
    jsxClasses = []
  }

  const merged = Array.from(new Set([...baseClasses, ...jsxClasses]))
  const nativeNormalized = normalizeWithNativeParser(merged)
  if (nativeNormalized) return nativeNormalized

  return merged
}

export function isScannableFile(filePath: string, includeExtensions = DEFAULT_EXTENSIONS): boolean {
  return includeExtensions.includes(path.extname(filePath))
}

export function scanFile(filePath: string): ScanFileResult {
  const source = fs.readFileSync(filePath, "utf8")
  // Use Rust hash when available
  const hash = hashContentNative(source) ?? undefined
  return {
    file: filePath,
    classes: scanSource(source),
    ...(hash ? { hash } : {}),
  }
}

export function scanWorkspace(
  rootDir: string,
  options: ScanWorkspaceOptions = {}
): ScanWorkspaceResult {
  const includeExtensions = options.includeExtensions ?? DEFAULT_EXTENSIONS
  const extensionSet = buildExtensionSet(includeExtensions)
  const ignoreDirectories = new Set(options.ignoreDirectories ?? DEFAULT_IGNORES)
  const useCache = options.useCache ?? true
  const smartInvalidation = options.smartInvalidation ?? true

  const files: ScanFileResult[] = []
  const unique = new Set<string>()
  const candidates = collectCandidates(rootDir, ignoreDirectories, extensionSet)

  const processResult = (result: ScanFileResult) => {
    files.push(result)
    for (const cls of result.classes) unique.add(cls)
  }

  // Native full-workspace scan is only used when cache is explicitly disabled.
  if (!options.cacheDir && !useCache) {
    const nativeResult = scanWorkspaceNative(rootDir, includeExtensions)
    if (nativeResult) {
      return {
        files: nativeResult.files.map((f) => ({ file: f.file, classes: f.classes })),
        totalFiles: nativeResult.totalFiles,
        uniqueClasses: nativeResult.uniqueClasses,
      }
    }
  }

  // Sprint 2: persistent Rust cache path for faster cold starts.
  if (useCache && isRustCacheAvailable()) {
    let cacheEntries: NativeCacheEntry[] = []
    try {
      cacheEntries = readCache(rootDir, options.cacheDir)
    } catch (error) {
      cacheEntries = []
      log.debug(
        `cache read failed, continuing without persisted cache: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }

    const cacheMap = new Map(cacheEntries.map((entry) => [entry.file, entry]))
    const nowMs = Date.now()
    const ranked: Array<{
      filePath: string
      stat: fs.Stats
      size: number
      cached?: NativeCacheEntry
      priority: number
    }> = []

    for (const filePath of candidates) {
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }

      const size = toCacheSize(stat.size)
      const cached = cacheMap.get(filePath)
      const priority = filePriority(
        stat.mtimeMs,
        size,
        cached
          ? {
              mtimeMs: cached.mtimeMs,
              size: cached.size,
              hitCount: cached.hitCount,
              lastSeenMs: 0,
            }
          : undefined,
        nowMs
      )

      ranked.push({ filePath, stat, size, cached, priority })
    }

    ranked.sort((a, b) => b.priority - a.priority)

    const updatedEntries: NativeCacheEntry[] = []

    for (const { filePath, stat, size, cached } of ranked) {
      let content: string
      try {
        content = fs.readFileSync(filePath, "utf8")
      } catch {
        continue
      }

      const hash = hashContentNative(content) ?? hashContentFallback(content)
      if (
        cached &&
        cached.hash === hash &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === size
      ) {
        log.debug(`cache HIT ${filePath}`)
        processResult({ file: filePath, classes: cached.classes })
        updatedEntries.push({
          file: filePath,
          classes: cached.classes,
          hash: cached.hash,
          mtimeMs: stat.mtimeMs,
          size,
          hitCount: (cached.hitCount ?? 0) + 1,
        })
        continue
      }

      log.debug(`cache MISS ${filePath}`)
      const classes = scanSource(content)
      processResult({ file: filePath, classes })
      updatedEntries.push({
        file: filePath,
        classes,
        hash,
        mtimeMs: stat.mtimeMs,
        size,
        hitCount: 1,
      })
    }

    try {
      writeCache(rootDir, updatedEntries, options.cacheDir)
    } catch (error) {
      // non-critical cache persistence failure
      log.debug(`cache write failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {
      files,
      totalFiles: files.length,
      uniqueClasses: Array.from(unique).sort(),
    }
  }

  // JS fallback path (legacy ScanCache + SmartCache).
  const cache = useCache ? new ScanCache(rootDir, { cacheDir: options.cacheDir }) : null
  const smartCache = cache && smartInvalidation ? new SmartCache(cache) : null

  if (!cache) {
    for (const filePath of candidates) {
      processResult(scanFile(filePath))
    }
  } else if (smartCache) {
    for (const { filePath, stat, cached } of smartCache.rankFiles(candidates)) {
      let result: ScanFileResult | null = null
      const cacheEntry = cached ?? cache.get(filePath)

      if (cacheEntry && cacheEntry.mtimeMs === stat.mtimeMs && cacheEntry.size === stat.size) {
        result = { file: filePath, classes: cacheEntry.classes }
        cache.touch(filePath)
      }

      if (!result) {
        result = scanFile(filePath)
        cache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          classes: result.classes,
          hitCount: 1,
          lastSeenMs: Date.now(),
        })
      }

      processResult(result)
    }
  } else {
    for (const filePath of candidates) {
      const stat = fs.statSync(filePath)
      let result: ScanFileResult | null = null
      const cacheEntry = cache.get(filePath)

      if (cacheEntry && cacheEntry.mtimeMs === stat.mtimeMs && cacheEntry.size === stat.size) {
        result = { file: filePath, classes: cacheEntry.classes }
        cache.touch(filePath)
      }

      if (!result) {
        result = scanFile(filePath)
        cache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          classes: result.classes,
          hitCount: 1,
          lastSeenMs: Date.now(),
        })
      }

      processResult(result)
    }
  }

  if (smartCache) {
    smartCache.invalidateMissing(new Set(candidates))
  }
  cache?.save()

  return {
    files,
    totalFiles: files.length,
    uniqueClasses: Array.from(unique).sort(),
  }
}

export async function scanWorkspaceAsync(
  rootDir: string,
  options: ScanWorkspaceOptions = {}
): Promise<ScanWorkspaceResult> {
  if (process.env.TWS_DISABLE_SCANNER_WORKER === "1") {
    return scanWorkspace(rootDir, options)
  }

  try {
    return await scanWorkspaceInWorker(rootDir, options)
  } catch (error) {
    log.debug(
      `worker scan failed, falling back to sync scanner: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return scanWorkspace(rootDir, options)
  }
}
// Rust cache bridge — replaces cache.ts + smart-cache.ts in hot paths
export {
  rustCacheRead,
  rustCacheWrite,
  rustCachePriority,
  isRustCacheAvailable,
} from "./rust-cache-bridge"

// ── New Rust-backed modules ───────────────────────────────────────────────────
export { readCache, writeCache, filePriority } from "./cache-native"
export type { NativeCacheEntry } from "./cache-native"
export { astExtractClasses } from "./ast-native"
export type { AstExtractResult } from "./ast-native"

// ── Oxc AST parser (real AST, bukan regex) ────────────────────────────────────
export { oxcExtractClasses } from "./oxc-bridge"

// ── In-memory scan cache (Rust DashMap backend) ───────────────────────────────
export {
  cacheGet,
  cachePut,
  cacheInvalidate,
  cacheSize,
  isNative as isCacheNative,
} from "./in-memory-cache"

// ── Upgrade scanSource: pakai oxcExtractClasses sebagai tier kedua ────────────

/**
 * Upgrade path: scanSource dengan Oxc AST + regex hybrid.
 * Lebih akurat dari scanSource biasa — deteksi component names + imports.
 * Otomatis fallback ke scanSource jika Oxc tidak tersedia.
 */
export function scanSourceOxc(
  source: string,
  filename = "file.tsx"
): {
  classes: string[]
  componentNames: string[]
  hasUseClient: boolean
  imports: string[]
} {
  const { oxcExtractClasses: oxcFn } = require("./oxc-bridge") as typeof import("./oxc-bridge")
  try {
    const r = oxcFn(source, filename)
    return {
      classes: r.classes,
      componentNames: r.componentNames,
      hasUseClient: r.hasUseClient,
      imports: r.imports,
    }
  } catch {
    return { classes: scanSource(source), componentNames: [], hasUseClient: false, imports: [] }
  }
}

// ── Upgrade scanFile: pakai in-memory cache + oxc ─────────────────────────────

/**
 * scanFile dengan in-memory Rust cache.
 * Cache miss → scan → store. Cache hit → return langsung.
 */
export function scanFileCached(filePath: string): string[] {
  const { cacheGet, cachePut } = require("./in-memory-cache") as typeof import("./in-memory-cache")

  const content = fs.readFileSync(filePath, "utf8")
  const hash = hashContentNative(content) ?? content.slice(0, 64)

  // Cache hit
  const cached = cacheGet(filePath, hash)
  if (cached) return cached

  // Cache miss — scan
  const classes = scanSource(content)
  const stat = (() => {
    try {
      return fs.statSync(filePath)
    } catch {
      return null
    }
  })()
  cachePut(filePath, hash, classes, stat?.mtimeMs ?? 0, stat?.size ?? 0)

  return classes
}
