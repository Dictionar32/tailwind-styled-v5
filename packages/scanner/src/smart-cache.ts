import fs from "node:fs"

import type { CachedScanFileEntry, ScanCache } from "./cache"

export interface RankedScanFile {
  filePath: string
  stat: fs.Stats
  cached?: CachedScanFileEntry
  priority: number
}

function safeMtimeDelta(stat: fs.Stats, cached?: CachedScanFileEntry): number {
  if (!cached) return Number.MAX_SAFE_INTEGER
  return Math.max(0, stat.mtimeMs - cached.mtimeMs)
}

export class SmartCache {
  constructor(private readonly cache: ScanCache) {}

  rankFiles(filePaths: string[]): RankedScanFile[] {
    const ranked: RankedScanFile[] = []
    const now = Date.now()

    for (const filePath of filePaths) {
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }

      const cached = this.cache.get(filePath)
      const priority = this.priorityOf(stat, cached, now)
      ranked.push({ filePath, stat, cached, priority })
    }

    ranked.sort((a, b) => b.priority - a.priority)
    return ranked
  }

  private priorityOf(stat: fs.Stats, cached: CachedScanFileEntry | undefined, now: number): number {
    if (!cached) return 1_000_000_000

    const mtimeDelta = safeMtimeDelta(stat, cached)
    const sizeDelta = Math.abs(stat.size - cached.size)
    const recency = cached.lastSeenMs ? now - cached.lastSeenMs : 0
    const hotness = cached.hitCount ?? 0

    return mtimeDelta * 1000 + sizeDelta * 10 + hotness * 100 - recency / 1000
  }

  invalidateMissing(presentFiles: Set<string>): void {
    for (const [filePath] of this.cache.entries()) {
      if (!presentFiles.has(filePath)) this.cache.delete(filePath)
    }
  }
}
