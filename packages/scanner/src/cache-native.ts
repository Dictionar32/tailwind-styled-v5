/**
 * tailwind-styled-v4 — Scanner Cache (Rust-backed)
 *
 * Replaces cache.ts + smart-cache.ts with Rust implementations.
 * Falls back to the original JS ScanCache when native is unavailable.
 */

import path from "node:path"
import _fs from "node:fs"
import { createRequire } from "node:module"
import { ScanCache } from "./cache"

// ── Native binding ────────────────────────────────────────────────────────────

interface NativeCacheBinding {
  cacheRead?: (path: string) => {
    entries: Array<{
      file: string
      classes: string[]
      hash: string
      mtimeMs: number
      size: number
      hitCount: number
    }>
    version: number
  }
  cacheWrite?: (
    path: string,
    entries: Array<{
      file: string
      classes: string[]
      hash: string
      mtimeMs: number
      size: number
      hitCount: number
    }>
  ) => boolean
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
    path.resolve(runtimeDir, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeCacheBinding
      if (mod?.cacheRead && mod?.cacheWrite) return (_binding = mod)
    } catch {
      /* next */
    }
  }
  return (_binding = null)
}

// ── Default cache path ─────────────────────────────────────────────────────────

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
  const binding = getBinding()

  if (binding?.cacheRead) {
    // cache_read sekarang return napi::Result — bisa throw jika file tidak bisa dibaca
    const result = binding.cacheRead(cachePath)
    return result.entries.map((e) => ({
      file: e.file,
      classes: e.classes,
      hash: e.hash,
      mtimeMs: e.mtimeMs,
      size: e.size,
      hitCount: e.hitCount,
    }))
  }

  // JS fallback
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
  const binding = getBinding()

  if (binding?.cacheWrite) {
    binding.cacheWrite(cachePath, entries)
    return
  }

  // JS fallback
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
  const binding = getBinding()
  if (binding?.cachePriority) {
    return binding.cachePriority(
      mtimeMs,
      size,
      cached?.mtimeMs ?? 0,
      cached?.size ?? 0,
      cached?.hitCount ?? 0,
      cached?.lastSeenMs ?? 0,
      nowMs
    )
  }

  // JS fallback: same formula as Rust
  if (!cached) return 1_000_000_000
  const delta = Math.max(0, mtimeMs - cached.mtimeMs)
  const sizeDelta = Math.abs(size - cached.size)
  const recency = cached.lastSeenMs ? nowMs - cached.lastSeenMs : 0
  return delta * 1000 + sizeDelta * 10 + (cached.hitCount ?? 0) * 100 - recency / 1000
}
