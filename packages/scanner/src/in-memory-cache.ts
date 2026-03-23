/**
 * tailwind-styled-v4 — In-memory scan cache (Rust DashMap backend).
 *
 * Menggantikan ScanCache (JS) dengan cache in-process yang lebih cepat.
 * Cache hidup selama proses Node.js — tidak perlu baca/tulis file di hot path.
 */

import path from "node:path"
import { createRequire } from "node:module"

interface NativeCacheBinding {
  scanCacheGet?: (filePath: string, contentHash: string) => string[] | null
  scanCachePut?: (
    filePath: string,
    contentHash: string,
    classes: string[],
    mtimeMs: number,
    size: number
  ) => void
  scanCacheInvalidate?: (filePath: string) => void
  scanCacheStats?: () => { size: number }
}

let _binding: NativeCacheBinding | null | undefined

function getBinding(): NativeCacheBinding | null {
  if (_binding !== undefined) return _binding
  if (process.env.TWS_NO_NATIVE === "1") return (_binding = null)

  const req = typeof require === "function" ? require : createRequire(import.meta.url)
  const candidates = [
    path.resolve(process.cwd(), "native", "tailwind_styled_parser.node"),
    path.resolve(__dirname, "..", "..", "..", "..", "native", "tailwind_styled_parser.node"),
  ]
  for (const c of candidates) {
    try {
      const mod = req(c) as NativeCacheBinding
      if (mod?.scanCacheGet && mod?.scanCachePut) return (_binding = mod)
    } catch {
      /* next */
    }
  }
  return (_binding = null)
}

// ── JS fallback cache ─────────────────────────────────────────────────────────

const jsCache = new Map<string, { hash: string; classes: string[]; hits: number }>()

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ambil kelas dari cache jika hash masih cocok (file belum berubah).
 * Return null jika cache miss atau file berubah.
 */
export function cacheGet(filePath: string, contentHash: string): string[] | null {
  const b = getBinding()
  if (b?.scanCacheGet) {
    return b.scanCacheGet(filePath, contentHash) ?? null
  }
  const entry = jsCache.get(filePath)
  if (!entry || entry.hash !== contentHash) return null
  entry.hits++
  return entry.classes
}

/**
 * Simpan hasil ekstraksi ke cache.
 */
export function cachePut(
  filePath: string,
  contentHash: string,
  classes: string[],
  mtimeMs: number,
  size: number
): void {
  const b = getBinding()
  if (b?.scanCachePut) {
    b.scanCachePut(filePath, contentHash, classes, mtimeMs, size)
    return
  }
  jsCache.set(filePath, { hash: contentHash, classes, hits: 0 })
}

/**
 * Invalidate cache untuk file yang dihapus atau direname.
 */
export function cacheInvalidate(filePath: string): void {
  getBinding()?.scanCacheInvalidate?.(filePath)
  jsCache.delete(filePath)
}

/**
 * Jumlah entry di cache saat ini.
 */
export function cacheSize(): number {
  return getBinding()?.scanCacheStats?.().size ?? jsCache.size
}

/**
 * Cek apakah menggunakan Rust backend.
 */
export function isNative(): boolean {
  return getBinding() !== null
}
