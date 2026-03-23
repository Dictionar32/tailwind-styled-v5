import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"

import { extractAllClasses } from "@tailwind-styled/compiler"
import { createLogger } from "@tailwind-styled/shared"
import { filePriority, type NativeCacheEntry, readCache, writeCache } from "./cache-native"
import { hashContentNative, isRustCacheAvailable } from "./native-bridge"

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

function extractClassesJs(source: string): string[] {
  return extractAllClasses(source)
}

export function scanSource(source: string): string[] {
  const nativeBinding = loadNativeParserBinding()
  if (nativeBinding && typeof nativeBinding.parse_classes === "function") {
    try {
      const baseClasses = extractClassesJs(source)
      const nativeNormalized = normalizeWithNativeParser(baseClasses)
      if (nativeNormalized) return nativeNormalized
    } catch {
      // Fall through to JS-only path
    }
  }

  return extractClassesJs(source)
}

export function isScannableFile(filePath: string, includeExtensions = DEFAULT_EXTENSIONS): boolean {
  return includeExtensions.includes(path.extname(filePath))
}

export function scanFile(filePath: string): ScanFileResult {
  const source = fs.readFileSync(filePath, "utf8")
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

  const { scanWorkspaceNative } = require("./native-bridge")

  if (!options.cacheDir && !useCache) {
    const nativeResult = scanWorkspaceNative(rootDir, includeExtensions)
    if (nativeResult) {
      return {
        files: nativeResult.files.map((f: { file: string; classes: string[] }) => ({
          file: f.file,
          classes: f.classes,
        })),
        totalFiles: nativeResult.totalFiles,
        uniqueClasses: nativeResult.uniqueClasses,
      }
    }
  }

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
      log.debug(`cache write failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {
      files,
      totalFiles: files.length,
      uniqueClasses: Array.from(unique).sort(),
    }
  }

  for (const filePath of candidates) {
    processResult(scanFile(filePath))
  }

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
