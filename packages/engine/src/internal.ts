/**
 * @tailwind-styled/engine v5 — Internal API
 *
 * This module contains internal functions that are NOT part of the public API.
 * These functions may change at any time without notice.
 *
 * Usage: import from "@tailwind-styled/engine/internal"
 */

export { applyIncrementalChange } from "./incremental"
export type { EngineMetricsSnapshot } from "./metrics"
export { EngineMetricsCollector } from "./metrics"
export {
  type EnginePlugin,
  type EnginePluginContext,
  type EngineWatchContext,
  runAfterBuild,
  runAfterScan,
  runAfterWatch,
  runBeforeBuild,
  runBeforeScan,
  runBeforeWatch,
  runOnError,
  runTransformClasses,
} from "./plugin-api"
export type { WorkspaceWatcher } from "./watch"
export { watchWorkspace as watchWorkspaceLegacy } from "./watch"
export type { WatchCallback, WatchEvent, WatchEventKind, WatchHandle } from "./watch-native"
export { watchWorkspace as watchWorkspaceNative } from "./watch-native"
