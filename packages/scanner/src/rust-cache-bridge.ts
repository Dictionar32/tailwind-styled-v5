/**
 * Rust-backed scanner cache bridge.
 * Replaces cache.ts + smart-cache.ts with native Rust implementations.
 */
import path from "node:path"
import { createRequire } from "node:module"

interface NativeCacheEntry {
  file: string
  classes: string[]
  hash: string
  mtimeMs: number
  size: number
  hitCount: number
}

interface NativeCacheBinding {
  cacheRead?: (path: string) => { entries: NativeCacheEntry[]; version: number }
  cacheWrite?: (path: string, entries: NativeCacheEntry[]) => boolean
  cachePriority?: (
    mtimeMs: number,
    size: number,
    cachedMtimeMs: number,
    cachedSize: number,
    cachedHitCount: number,
    cachedLastSeenMs: number,
    nowMs: number
  ) => number
}

let _binding: NativeCacheBinding | null | undefined

function getBinding(): NativeCacheBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1") return (_binding = null)

  const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd()
  const req =
    typeof require === "function" ? require : createRequire(path.join(runtimeDir, "noop.cjs"))
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(runtimeDir, "..", "..", "..", "native", "tailwind_styled_parser.node"),
    path.resolve(runtimeDir, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeCacheBinding
      if (mod?.cacheRead && mod?.cacheWrite) return (_binding = mod)
    } catch {
      /* try next */
    }
  }
  return (_binding = null)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RustCacheEntry {
  file: string
  classes: string[]
  hash: string
  mtimeMs: number
  size: number
  hitCount: number
}

export function rustCacheRead(cachePath: string): RustCacheEntry[] {
  return getBinding()?.cacheRead?.(cachePath)?.entries ?? []
}

export function rustCacheWrite(cachePath: string, entries: RustCacheEntry[]): boolean {
  return getBinding()?.cacheWrite?.(cachePath, entries) ?? false
}

export function rustCachePriority(
  mtimeMs: number,
  size: number,
  cachedMtimeMs: number,
  cachedSize: number,
  cachedHitCount: number,
  cachedLastSeenMs: number
): number {
  return (
    getBinding()?.cachePriority?.(
      mtimeMs,
      size,
      cachedMtimeMs,
      cachedSize,
      cachedHitCount,
      cachedLastSeenMs,
      Date.now()
    ) ?? (cachedMtimeMs === 0 ? 1e9 : (mtimeMs - cachedMtimeMs) * 1000)
  )
}

export function isRustCacheAvailable(): boolean {
  return getBinding() !== null
}
