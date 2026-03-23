/**
 * tailwind-styled-v4 — Scanner Cache (Rust-backed)
 *
 * Replaces cache.ts + smart-cache.ts with Rust implementations.
 * Falls back to the original JS ScanCache when native is unavailable.
 */

import path from "node:path"
import { ScanCache } from "./cache"
import {
  cachePriorityNative,
  cacheReadNative,
  cacheWriteNative,
  hasNativeScannerBinding,
} from "./native-bridge"

function defaultCachePath(rootDir: string, cacheDir?: string): string {
  const dir = cacheDir
    ? path.resolve(rootDir, cacheDir)
    : path.join(process.cwd(), ".cache", "tailwind-styled")
  return path.join(dir, "scanner-cache.json")
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface NativeCacheEntry {
  file: string
  classes: string[]
  hash: string
  mtimeMs: number
  size: number
  hitCount: number
}

/**
 * Read scanner cache from disk using Rust parser.
 * Falls back to JS ScanCache if native unavailable.
 */
export function readCache(rootDir: string, cacheDir?: string): NativeCacheEntry[] {
  const cachePath = defaultCachePath(rootDir, cacheDir)

  const result = cacheReadNative(cachePath)
  if (result) {
    return result.entries.map((e) => ({
      file: e.file,
      classes: e.classes,
      hash: e.hash,
      mtimeMs: e.mtimeMs,
      size: e.size,
      hitCount: e.hitCount,
    }))
  }

  const cache = new ScanCache(rootDir, { cacheDir })
  return cache.entries().map(([file, entry]) => ({
    file,
    classes: entry.classes,
    hash: "",
    mtimeMs: entry.mtimeMs,
    size: entry.size,
    hitCount: entry.hitCount ?? 0,
  }))
}

/**
 * Write scanner cache to disk using Rust serialiser.
 * Falls back to JS ScanCache if native unavailable.
 */
export function writeCache(rootDir: string, entries: NativeCacheEntry[], cacheDir?: string): void {
  const cachePath = defaultCachePath(rootDir, cacheDir)

  const success = cacheWriteNative(cachePath, entries)
  if (success) return

  const cache = new ScanCache(rootDir, { cacheDir })
  for (const e of entries) {
    cache.set(e.file, { mtimeMs: e.mtimeMs, size: e.size, classes: e.classes })
  }
  cache.save()
}

/**
 * Compute priority score for a file using the Rust SmartCache algorithm.
 * Higher = process first.
 */
export function filePriority(
  mtimeMs: number,
  size: number,
  cached: { mtimeMs: number; size: number; hitCount: number; lastSeenMs?: number } | undefined,
  nowMs = Date.now()
): number {
  const priority = cachePriorityNative(
    mtimeMs,
    size,
    cached?.mtimeMs ?? 0,
    cached?.size ?? 0,
    cached?.hitCount ?? 0,
    cached?.lastSeenMs ?? 0,
    nowMs
  )
  if (priority !== null) return priority

  if (!cached) return 1_000_000_000
  const delta = Math.max(0, mtimeMs - cached.mtimeMs)
  const sizeDelta = Math.abs(size - cached.size)
  const recency = cached.lastSeenMs ? nowMs - cached.lastSeenMs : 0
  return delta * 1000 + sizeDelta * 10 + (cached.hitCount ?? 0) * 100 - recency / 1000
}
