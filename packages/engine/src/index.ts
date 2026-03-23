import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { analyzeWorkspace } from "@tailwind-styled/analyzer"
import { generateCssForClasses, mergeClassesStatic } from "@tailwind-styled/compiler"
import {
  type ScanWorkspaceOptions,
  type ScanWorkspaceResult,
  scanWorkspaceAsync,
} from "@tailwind-styled/scanner"
import { createLogger } from "@tailwind-styled/shared"

import { applyIncrementalChange } from "./incremental"
import { EngineMetricsCollector, type EngineMetricsSnapshot } from "./metrics"
import {
  type EnginePlugin,
  runAfterBuild,
  runAfterScan,
  runAfterWatch,
  runBeforeBuild,
  runBeforeScan,
  runBeforeWatch,
  runOnError,
  runTransformClasses,
} from "./plugin-api"
import { type WorkspaceWatcher, watchWorkspace } from "./watch"

const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024
const DEFAULT_FLUSH_DEBOUNCE_MS = 100
const DEFAULT_MAX_EVENTS_PER_FLUSH = 100
const log = createLogger("engine")

export interface EngineOptions {
  root?: string
  scanner?: ScanWorkspaceOptions
  compileCss?: boolean
  tailwindConfigPath?: string
  plugins?: EnginePlugin[]
  /** Enable analyzer integration - provides semantic report (unused classes, conflicts). Default: false */
  analyze?: boolean
}

export interface EngineWatchOptions {
  debounceMs?: number
  maxEventsPerFlush?: number
  largeFileThreshold?: number
}

export interface BuildResult {
  scan: ScanWorkspaceResult
  mergedClassList: string
  css: string
  /** Analyzer semantic report - present when analyze: true in options */
  analysis?: {
    unusedClasses: unknown[]
    classConflicts: Array<{ className: string; files: string[] }>
    classUsage: Record<string, number>
  }
}

type EngineBuildWatchEventType = "initial" | "change" | "unlink" | "full-rescan"

export type EngineWatchEvent =
  | {
      type: EngineBuildWatchEventType
      filePath?: string
      result: BuildResult
      metrics?: EngineMetricsSnapshot
    }
  | {
      type: "error"
      filePath?: string
      error: string
      metrics?: EngineMetricsSnapshot
    }

export interface TailwindStyledEngine {
  scan(): Promise<ScanWorkspaceResult>
  build(): Promise<BuildResult>
  watch(
    onEvent: (event: EngineWatchEvent) => void,
    options?: EngineWatchOptions
  ): Promise<{ close(): void }>
}

async function loadTailwindConfigFromPath(
  root: string,
  tailwindConfigPath?: string
): Promise<Record<string, unknown> | undefined> {
  if (!tailwindConfigPath) return undefined

  const configPath = path.resolve(root, tailwindConfigPath)
  if (!fs.existsSync(configPath)) {
    throw new Error(`tailwindConfigPath not found: ${configPath}`)
  }

  const imported = await import(pathToFileURL(configPath).href)
  const config = (imported.default ?? imported) as Record<string, unknown>
  return config
}

async function tryRunAnalyzer(root: string, scan: ScanWorkspaceResult) {
  try {
    const { __internal } = await import("@tailwind-styled/analyzer")
    const counts = __internal.collectClassCounts(scan)

    const classUsage: Record<string, number> = {}
    for (const [name, count] of counts) {
      classUsage[name] = count
    }

    return {
      unusedClasses: Array.from(counts.keys()).filter((c) => counts.get(c) === 0),
      classConflicts: [],
      classUsage,
    }
  } catch (e) {
    log.warn("Analyzer not available:", String(e))
    return undefined
  }
}

async function buildFromScan(
  scan: ScanWorkspaceResult,
  root: string,
  options: EngineOptions,
  tailwindConfig?: Record<string, unknown>
): Promise<BuildResult> {
  const plugins = options.plugins ?? []
  const context = { root, timestamp: Date.now() }

  await runBeforeBuild(plugins, scan, context)
  const transformedClasses = await runTransformClasses(plugins, scan.uniqueClasses, context)
  const mergedClassList = mergeClassesStatic(transformedClasses.join(" "))

  let css = ""
  if (options.compileCss !== false && mergedClassList.length > 0) {
    css = await generateCssForClasses(
      mergedClassList.split(/\s+/).filter(Boolean),
      tailwindConfig,
      root
    )
  }

  let analysis: BuildResult["analysis"]
  if (options.analyze) {
    analysis = await tryRunAnalyzer(root, scan)
  }

  const result: BuildResult = {
    scan,
    mergedClassList,
    css,
    analysis,
  }

  return runAfterBuild(plugins, result, context)
}

export async function createEngine(options: EngineOptions = {}): Promise<TailwindStyledEngine> {
  const root = options.root ?? process.cwd()
  const resolvedRoot = path.resolve(root)

  const plugins = options.plugins ?? []

  let cachedTailwindConfig: Record<string, unknown> | undefined
  let tailwindConfigLoaded = false

  const getTailwindConfig = async (): Promise<Record<string, unknown> | undefined> => {
    if (tailwindConfigLoaded) return cachedTailwindConfig
    cachedTailwindConfig = await loadTailwindConfigFromPath(
      resolvedRoot,
      options.tailwindConfigPath
    )
    tailwindConfigLoaded = true
    return cachedTailwindConfig
  }

  const reportEngineError = async (error: unknown): Promise<Error> => {
    const normalized = error instanceof Error ? error : new Error(String(error))
    const context = { root: resolvedRoot, timestamp: Date.now() }
    try {
      await runOnError(plugins, normalized, context)
    } catch (pluginError) {
      log.error(
        "plugin onError hook failed:",
        pluginError instanceof Error ? pluginError.message : String(pluginError)
      )
    }
    log.error(normalized.message)
    return normalized
  }

  const doScan = async (): Promise<ScanWorkspaceResult> => {
    try {
      const context = { root: resolvedRoot, timestamp: Date.now() }
      await runBeforeScan(plugins, context)
      const scan = await scanWorkspaceAsync(resolvedRoot, options.scanner)
      return await runAfterScan(plugins, scan, context)
    } catch (error) {
      throw await reportEngineError(error)
    }
  }

  return {
    scan: doScan,
    async build(): Promise<BuildResult> {
      const scan = await doScan()
      try {
        return await buildFromScan(scan, resolvedRoot, options, await getTailwindConfig())
      } catch (error) {
        throw await reportEngineError(error)
      }
    },
    async watch(
      onEvent: (event: EngineWatchEvent) => void,
      watchOptions: EngineWatchOptions = {}
    ): Promise<{ close(): void }> {
      const flushDebounceMs = watchOptions.debounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS
      const maxEventsPerFlush = watchOptions.maxEventsPerFlush ?? DEFAULT_MAX_EVENTS_PER_FLUSH
      const largeFileThreshold =
        watchOptions.largeFileThreshold ?? DEFAULT_LARGE_FILE_THRESHOLD_BYTES

      const tailwindConfig = await getTailwindConfig()
      const watchContext = { root: resolvedRoot, timestamp: Date.now() }
      await runBeforeWatch(plugins, watchContext)
      let currentScan = await doScan()
      try {
        onEvent({
          type: "initial",
          result: await buildFromScan(currentScan, resolvedRoot, options, tailwindConfig),
        })
      } catch (error) {
        const normalized = await reportEngineError(error)
        onEvent({ type: "error", error: normalized.message })
        throw normalized
      }

      let timer: NodeJS.Timeout | null = null
      const queue: Array<{ type: "change" | "unlink"; filePath: string }> = []
      const metrics = new EngineMetricsCollector()

      const scheduleFlush = (): void => {
        if (timer) return
        timer = setTimeout(() => {
          timer = null
          void flushBatch()
        }, flushDebounceMs)
      }

      const shouldForceFullRescan = (event: {
        type: "change" | "unlink"
        filePath: string
      }): boolean => {
        if (event.type === "unlink") return false
        try {
          const stat = fs.statSync(event.filePath)
          if (stat.size > largeFileThreshold) {
            metrics.markSkippedLargeFile()
            return true
          }
        } catch {
          return false
        }
        return false
      }

      const flushBatch = async (): Promise<void> => {
        if (queue.length === 0) return

        const batch = queue.splice(0, maxEventsPerFlush)
        metrics.markBatchProcessed(batch.length)

        let forceRescan = false
        for (const event of batch) {
          if (shouldForceFullRescan(event)) {
            forceRescan = true
            break
          }
        }

        const lastEvent = batch[batch.length - 1]
        let emittedType: EngineBuildWatchEventType = lastEvent.type

        try {
          if (forceRescan) {
            currentScan = await doScan()
            metrics.markFullRescan()
            emittedType = "full-rescan"
          } else {
            for (const event of batch) {
              currentScan = applyIncrementalChange(
                currentScan,
                event.filePath,
                event.type,
                options.scanner
              )
              metrics.markIncremental()
            }
          }
        } catch (error) {
          const normalized = await reportEngineError(error)
          log.warn("incremental path failed, forcing full rescan:", normalized.message)
          currentScan = await doScan()
          metrics.markFullRescan()
          emittedType = "full-rescan"
        }

        try {
          const started = Date.now()
          const result = await buildFromScan(currentScan, resolvedRoot, options, tailwindConfig)
          metrics.markBuildDuration(Date.now() - started)

          onEvent({
            type: emittedType,
            filePath: lastEvent.filePath,
            result,
            metrics: metrics.snapshot(),
          })
        } catch (error) {
          const normalized = await reportEngineError(error)
          onEvent({
            type: "error",
            filePath: lastEvent.filePath,
            error: normalized.message,
            metrics: metrics.snapshot(),
          })
        }

        if (queue.length > 0) scheduleFlush()
      }

      const watcher: WorkspaceWatcher = watchWorkspace(
        resolvedRoot,
        (event) => {
          queue.push(event)
          metrics.markEventReceived(queue.length)
          scheduleFlush()
        },
        {
          ignoreDirectories: options.scanner?.ignoreDirectories,
          debounceMs: flushDebounceMs,
          onError: (error, directory) => {
            void reportEngineError(error)
            onEvent({
              type: "error",
              filePath: directory,
              error: error.message,
              metrics: metrics.snapshot(),
            })
          },
        }
      )

      return {
        async close() {
          if (timer) clearTimeout(timer)
          watcher.close()
          await runAfterWatch(plugins, watchContext)
        },
      }
    },
  }
}
