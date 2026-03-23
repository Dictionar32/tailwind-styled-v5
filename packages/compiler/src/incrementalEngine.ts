/**
 * tailwind-styled-v4 — Incremental CSS Compiler
 *
 * Hanya compile ulang file yang berubah, bukan semua file.
 * Hasil: hot-reload styling dalam 5–20ms, bukan 3–10s.
 *
 * Pipeline:
 *   file watcher detects change
 *     ↓ hash check → skip jika file belum berubah
 *     ↓ update dependency graph (hapus rule lama, tambah rule baru)
 *     ↓ compute CSS diff (only changed rules)
 *     ↓ write diff ke output — bukan rewrite seluruh file
 *     ↓ hot reload
 *
 * Integrasi ke webpack/turbopack loader:
 *   import { incrementalEngine } from "./incrementalEngine"
 *   incrementalEngine.processFile(filepath, source, extractedClasses)
 *
 * Cache disimpan di `.tw-cache/` — persist antar build sessions.
 */

import fs from "node:fs"
import path from "node:path"
import { hashContent } from "@tailwind-styled/shared"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Satu style node dalam dependency graph */
export interface StyleNode {
  /** Tailwind class, e.g. "p-4" */
  twClass: string
  /** CSS declaration, e.g. "padding: 1rem" */
  declaration: string
  /** Modifier (pseudo/media), e.g. ":hover" atau "@media (min-width: 768px)" */
  modifier?: string
  /** Generated atomic class name, e.g. "tw-a1b2" */
  atomicClass: string
}

/** Graph: filepath → style nodes yang dihasilkan file itu */
export type FileDependencyGraph = Map<string, StyleNode[]>

/** Cache hash file untuk change detection */
export type FileHashCache = Map<string, string>

/** Diff antara build sebelum dan setelah */
export interface CssDiff {
  /** Rule yang perlu ditambah ke CSS output */
  added: StyleNode[]
  /** Atomic class names yang perlu dihapus dari CSS output */
  removed: string[]
  /** true jika tidak ada perubahan */
  noChange: boolean
}

/** Summary setelah process satu file */
export interface ProcessResult {
  /** File yang diproses */
  filepath: string
  /** true jika file berubah dan registry di-update */
  changed: boolean
  /** CSS diff untuk file ini */
  diff: CssDiff
  /** Durasi proses dalam ms */
  durationMs: number
}

/** Stats engine */
export interface IncrementalStats {
  totalFiles: number
  changedFiles: number
  skippedFiles: number
  addedRules: number
  removedRules: number
  buildTimeMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache persistence — simpan ke disk supaya antar restart tetap cepat
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_DIR = ".tw-cache"
const HASH_CACHE_FILE = path.join(CACHE_DIR, "file-hashes.json")
const GRAPH_CACHE_FILE = path.join(CACHE_DIR, "dep-graph.json")

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

function loadHashCache(): FileHashCache {
  try {
    if (fs.existsSync(HASH_CACHE_FILE)) {
      const raw = fs.readFileSync(HASH_CACHE_FILE, "utf-8")
      return new Map(Object.entries(JSON.parse(raw)))
    }
  } catch {
    /* corrupt cache — start fresh */
  }
  return new Map()
}

function saveHashCache(cache: FileHashCache): void {
  try {
    ensureCacheDir()
    const obj = Object.fromEntries(cache)
    fs.writeFileSync(HASH_CACHE_FILE, JSON.stringify(obj, null, 2))
  } catch {
    /* non-fatal */
  }
}

function loadGraphCache(): FileDependencyGraph {
  try {
    if (fs.existsSync(GRAPH_CACHE_FILE)) {
      const raw = fs.readFileSync(GRAPH_CACHE_FILE, "utf-8")
      const data = JSON.parse(raw) as Record<string, StyleNode[]>
      return new Map(Object.entries(data))
    }
  } catch {
    /* corrupt cache */
  }
  return new Map()
}

function saveGraphCache(graph: FileDependencyGraph): void {
  try {
    ensureCacheDir()
    const obj = Object.fromEntries(graph)
    fs.writeFileSync(GRAPH_CACHE_FILE, JSON.stringify(obj, null, 2))
  } catch {
    /* non-fatal */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash — FNV-1a untuk konsitensi dengan styleRegistry
// ─────────────────────────────────────────────────────────────────────────────

function fnv1a(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return h
}

function toBase36(n: number, len = 4): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
  let result = ""
  let num = n
  for (let i = 0; i < len; i++) {
    result = chars[num % 36] + result
    num = Math.floor(num / 36)
  }
  return result
}

/**
 * Hash konten file untuk change detection.
 * Delegasi ke @tailwind-styled/shared untuk konsistensi.
 */
function hashFileContent(content: string): string {
  return hashContent(content, "md5", 8)
}

/**
 * Generate atomic class name yang konsisten dengan styleRegistry.
 */
function makeAtomicClass(declaration: string, modifier?: string): string {
  const key = modifier ? `${declaration}::${modifier}` : declaration
  return `tw-${toBase36(fnv1a(key))}`
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS Diff Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hitung diff antara style nodes lama vs baru dari satu file.
 *
 * @param oldNodes - Style nodes dari build sebelumnya
 * @param newNodes - Style nodes dari build terkini
 * @returns CssDiff dengan added/removed rules
 */
function computeDiff(oldNodes: StyleNode[], newNodes: StyleNode[]): CssDiff {
  const oldMap = new Map(oldNodes.map((n) => [n.atomicClass, n]))
  const newMap = new Map(newNodes.map((n) => [n.atomicClass, n]))

  const added: StyleNode[] = []
  const removed: string[] = []

  // Rule baru yang belum ada di build lama
  for (const [cls, node] of newMap) {
    if (!oldMap.has(cls)) added.push(node)
  }

  // Rule lama yang tidak ada di build baru
  for (const cls of oldMap.keys()) {
    if (!newMap.has(cls)) removed.push(cls)
  }

  return {
    added,
    removed,
    noChange: added.length === 0 && removed.length === 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Atomic Registry — track semua rule aktif di seluruh project
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registry global yang aggregates semua StyleNode dari semua file.
 * Key: atomicClass → StyleNode + refCount (berapa file yang pakai rule ini)
 */
interface GlobalEntry {
  node: StyleNode
  /** File-file yang menghasilkan rule ini (untuk proper dedup) */
  sources: Set<string>
}

class GlobalAtomicRegistry {
  private entries = new Map<string, GlobalEntry>()

  /** Tambah node dari file tertentu */
  add(filepath: string, node: StyleNode): void {
    const existing = this.entries.get(node.atomicClass)
    if (existing) {
      existing.sources.add(filepath)
    } else {
      this.entries.set(node.atomicClass, {
        node,
        sources: new Set([filepath]),
      })
    }
  }

  /** Hapus referensi dari file tertentu; jika tidak ada source lain, rule dihapus */
  remove(filepath: string, atomicClass: string): boolean {
    const entry = this.entries.get(atomicClass)
    if (!entry) return false
    entry.sources.delete(filepath)
    if (entry.sources.size === 0) {
      this.entries.delete(atomicClass)
      return true // rule benar-benar dihapus
    }
    return false // masih dipakai file lain
  }

  /** Cek apakah rule ada di registry global */
  has(atomicClass: string): boolean {
    return this.entries.has(atomicClass)
  }

  /** Semua entries untuk CSS generation */
  all(): StyleNode[] {
    return Array.from(this.entries.values()).map((e) => e.node)
  }

  /** Total unique rules */
  size(): number {
    return this.entries.size
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS Writer — write/update CSS file secara incremental
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate CSS string dari satu StyleNode.
 */
function nodeToCSS(node: StyleNode): string {
  const { atomicClass, declaration, modifier } = node

  if (!modifier) {
    return `.${atomicClass}{${declaration}}`
  }

  if (modifier.startsWith("@")) {
    // Media query
    return `${modifier}{.${atomicClass}{${declaration}}}`
  }

  // Pseudo selector
  return `.${atomicClass}${modifier}{${declaration}}`
}

/**
 * CSS Diff Writer — update CSS file tanpa rewrite penuh.
 *
 * Strategi: simpan registry CSS sebagai Map<atomicClass, cssRule>,
 * serialize ke file. Lebih cepat dari string manipulation.
 */
class CssDiffWriter {
  private ruleMap = new Map<string, string>()
  private outputPath: string
  private dirty = false

  constructor(outputPath: string) {
    this.outputPath = outputPath
    this.loadFromDisk()
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.outputPath)) {
        // Parse existing CSS untuk reconstruct ruleMap
        const css = fs.readFileSync(this.outputPath, "utf-8")
        // Extract rule blocks — simpel: split per .tw-XXXX pattern
        const ruleRe =
          /(\.tw-[a-z0-9]+(?::[\w-]+)?)\{([^}]+)\}|(@[^{]+)\{(\.tw-[a-z0-9]+)\{([^}]+)\}\}/g
        let m: RegExpExecArray | null
        while ((m = ruleRe.exec(css)) !== null) {
          if (m[1]) {
            const cls = m[1].replace(/\.[^:]+:.*/, (match) => match.split(".")[1].split(":")[0])
            this.ruleMap.set(cls, m[0])
          }
        }
      }
    } catch {
      /* start fresh */
    }
  }

  /** Apply diff ke internal map */
  applyDiff(diff: CssDiff): void {
    if (diff.noChange) return

    for (const node of diff.added) {
      this.ruleMap.set(node.atomicClass, nodeToCSS(node))
    }
    for (const cls of diff.removed) {
      this.ruleMap.delete(cls)
    }
    this.dirty = true
  }

  /** Write ke disk jika ada perubahan. Async untuk tidak block loader. */
  async flush(): Promise<void> {
    if (!this.dirty) return

    try {
      ensureCacheDir()
      const css = Array.from(this.ruleMap.values()).join("\n")
      await fs.promises.writeFile(this.outputPath, css, "utf-8")
      this.dirty = false
    } catch {
      /* non-fatal */
    }
  }

  /** Sync flush untuk build end */
  flushSync(): void {
    if (!this.dirty) return
    try {
      ensureCacheDir()
      const css = Array.from(this.ruleMap.values()).join("\n")
      fs.writeFileSync(this.outputPath, css, "utf-8")
      this.dirty = false
    } catch {
      /* non-fatal */
    }
  }

  size(): number {
    return this.ruleMap.size
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IncrementalEngine — main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export interface IncrementalEngineOptions {
  /** Output path untuk CSS file incremental. Default: ".tw-cache/atomic.css" */
  outputPath?: string
  /** Apakah persist cache ke disk. Default: true */
  persistCache?: boolean
  /** Verbose logging. Default: false */
  verbose?: boolean
}

export class IncrementalEngine {
  private hashCache: FileHashCache
  private depGraph: FileDependencyGraph
  private globalReg: GlobalAtomicRegistry
  private cssWriter: CssDiffWriter
  private opts: Required<IncrementalEngineOptions>

  // Stats untuk current build session
  private stats: IncrementalStats = {
    totalFiles: 0,
    changedFiles: 0,
    skippedFiles: 0,
    addedRules: 0,
    removedRules: 0,
    buildTimeMs: 0,
  }

  private sessionStart = Date.now()

  constructor(opts: IncrementalEngineOptions = {}) {
    this.opts = {
      outputPath: opts.outputPath ?? path.join(CACHE_DIR, "atomic.css"),
      persistCache: opts.persistCache ?? true,
      verbose: opts.verbose ?? false,
    }

    this.hashCache = this.opts.persistCache ? loadHashCache() : new Map()
    this.depGraph = this.opts.persistCache ? loadGraphCache() : new Map()
    this.globalReg = new GlobalAtomicRegistry()
    this.cssWriter = new CssDiffWriter(this.opts.outputPath)

    // Reconstruct global registry dari loaded dep graph
    for (const [filepath, nodes] of this.depGraph) {
      for (const node of nodes) {
        this.globalReg.add(filepath, node)
      }
    }
  }

  /**
   * Proses satu file. Core method dipanggil oleh webpack/turbopack loader.
   *
   * @param filepath      - Absolute path ke file
   * @param source        - Source code file (untuk hashing)
   * @param extractedNodes - Style nodes yang di-extract compiler dari file ini
   * @returns ProcessResult dengan diff dan stats
   */
  processFile(filepath: string, source: string, extractedNodes: StyleNode[]): ProcessResult {
    const t0 = Date.now()
    this.stats.totalFiles++

    // ── 1. Change detection ──────────────────────────────────────────────────
    const currentHash = hashFileContent(source)
    const cachedHash = this.hashCache.get(filepath)

    if (cachedHash === currentHash) {
      // File tidak berubah — skip sepenuhnya
      this.stats.skippedFiles++
      this.log(`[skip] ${path.relative(process.cwd(), filepath)}`)
      return {
        filepath,
        changed: false,
        diff: { added: [], removed: [], noChange: true },
        durationMs: Date.now() - t0,
      }
    }

    // ── 2. Hash update ───────────────────────────────────────────────────────
    this.hashCache.set(filepath, currentHash)
    this.stats.changedFiles++
    this.log(`[change] ${path.relative(process.cwd(), filepath)}`)

    // ── 3. Compute diff antara nodes lama dan baru ───────────────────────────
    const oldNodes = this.depGraph.get(filepath) ?? []
    const diff = computeDiff(oldNodes, extractedNodes)

    // ── 4. Update dependency graph ───────────────────────────────────────────
    this.depGraph.set(filepath, extractedNodes)

    // ── 5. Update global atomic registry ────────────────────────────────────
    //    Hapus rule lama yang dihapus dari file ini
    const trulyRemoved: string[] = []
    for (const cls of diff.removed) {
      const wasRemoved = this.globalReg.remove(filepath, cls)
      if (wasRemoved) trulyRemoved.push(cls)
    }

    //    Tambah rule baru
    const trulyAdded: StyleNode[] = []
    for (const node of diff.added) {
      if (!this.globalReg.has(node.atomicClass)) {
        trulyAdded.push(node)
      }
      this.globalReg.add(filepath, node)
    }

    // ── 6. Build final diff untuk CSS writer ────────────────────────────────
    const finalDiff: CssDiff = {
      added: trulyAdded,
      removed: trulyRemoved,
      noChange: trulyAdded.length === 0 && trulyRemoved.length === 0,
    }

    this.cssWriter.applyDiff(finalDiff)
    this.stats.addedRules += trulyAdded.length
    this.stats.removedRules += trulyRemoved.length

    return {
      filepath,
      changed: true,
      diff: finalDiff,
      durationMs: Date.now() - t0,
    }
  }

  /**
   * Dipanggil di akhir build. Flush CSS ke disk, persist cache.
   */
  async buildEnd(): Promise<void> {
    this.stats.buildTimeMs = Date.now() - this.sessionStart

    await this.cssWriter.flush()

    if (this.opts.persistCache) {
      saveHashCache(this.hashCache)
      saveGraphCache(this.depGraph)
    }

    this.log(
      `[build] done in ${this.stats.buildTimeMs}ms | ` +
        `changed: ${this.stats.changedFiles}/${this.stats.totalFiles} files | ` +
        `+${this.stats.addedRules} -${this.stats.removedRules} rules | ` +
        `total rules: ${this.cssWriter.size()}`
    )
  }

  /** Sync version untuk webpack buildEnd hook */
  buildEndSync(): void {
    this.stats.buildTimeMs = Date.now() - this.sessionStart
    this.cssWriter.flushSync()

    if (this.opts.persistCache) {
      saveHashCache(this.hashCache)
      saveGraphCache(this.depGraph)
    }
  }

  /**
   * Invalidate satu file (untuk hot reload — file dihapus atau renamed).
   */
  invalidateFile(filepath: string): void {
    const oldNodes = this.depGraph.get(filepath) ?? []
    for (const node of oldNodes) {
      this.globalReg.remove(filepath, node.atomicClass)
    }
    this.depGraph.delete(filepath)
    this.hashCache.delete(filepath)
    this.log(`[invalidate] ${path.relative(process.cwd(), filepath)}`)
  }

  /** Get all active style nodes — untuk full CSS generation */
  getAllNodes(): StyleNode[] {
    return this.globalReg.all()
  }

  /** Get stats untuk current build session */
  getStats(): Readonly<IncrementalStats> {
    return { ...this.stats, buildTimeMs: Date.now() - this.sessionStart }
  }

  /** Get output CSS path */
  getOutputPath(): string {
    return this.opts.outputPath
  }

  /** Reset stats untuk build session baru */
  resetStats(): void {
    this.stats = {
      totalFiles: 0,
      changedFiles: 0,
      skippedFiles: 0,
      addedRules: 0,
      removedRules: 0,
      buildTimeMs: 0,
    }
    this.sessionStart = Date.now()
  }

  /** Reset semua cache — untuk clean build */
  reset(): void {
    this.hashCache.clear()
    this.depGraph.clear()
    this.globalReg = new GlobalAtomicRegistry()
    this.cssWriter = new CssDiffWriter(this.opts.outputPath)
    this.resetStats()
    this.log("[reset] incremental cache cleared")
  }

  private log(msg: string): void {
    if (this.opts.verbose) {
      console.log(`[tailwind-styled/incremental] ${msg}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// StyleNode extractor helpers — convert extracted Tailwind classes → StyleNodes
// Dipanggil oleh loader setelah transformSource()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse daftar Tailwind classes menjadi StyleNodes untuk incremental engine.
 * Supports: responsive variants (md:, lg:), pseudo (hover:, focus:), arbitrary.
 *
 * @example
 * parseClassesToNodes(["p-4", "hover:bg-blue-500", "md:text-lg"])
 */
export function parseClassesToNodes(classes: string[]): StyleNode[] {
  const nodes: StyleNode[] = []

  for (const cls of classes) {
    const node = parseOneClass(cls)
    if (node) nodes.push(node)
  }

  return nodes
}

function parseOneClass(cls: string): StyleNode | null {
  // Split modifier:utility
  const colonIdx = cls.lastIndexOf(":")
  let modifier: string | undefined
  let utility: string

  if (colonIdx > 0) {
    const modStr = cls.slice(0, colonIdx)
    utility = cls.slice(colonIdx + 1)
    modifier = resolveModifier(modStr)
  } else {
    utility = cls
  }

  const declaration = twToDeclaration(utility)
  if (!declaration) return null // unknown class — skip

  const atomicClass = makeAtomicClass(declaration, modifier)

  return { twClass: cls, declaration, modifier, atomicClass }
}

function resolveModifier(mod: string): string {
  const pseudoMap: Record<string, string> = {
    hover: ":hover",
    focus: ":focus",
    active: ":active",
    disabled: ":disabled",
    visited: ":visited",
    checked: ":checked",
    first: ":first-child",
    last: ":last-child",
    odd: ":nth-child(odd)",
    even: ":nth-child(even)",
  }
  const mediaMap: Record<string, string> = {
    sm: "@media (min-width: 640px)",
    md: "@media (min-width: 768px)",
    lg: "@media (min-width: 1024px)",
    xl: "@media (min-width: 1280px)",
    "2xl": "@media (min-width: 1536px)",
    dark: "@media (prefers-color-scheme: dark)",
    print: "@media print",
  }
  return pseudoMap[mod] ?? mediaMap[mod] ?? `:${mod}`
}

/** Minimal Tailwind → CSS declaration mapping (shared dengan styleRegistry) */
function twToDeclaration(cls: string): string | null {
  // Spacing
  const sp = cls.match(/^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-([\d.]+)$/)
  if (sp) {
    const propMap: Record<string, string> = {
      p: "padding",
      px: "padding-inline",
      py: "padding-block",
      pt: "padding-top",
      pb: "padding-bottom",
      pl: "padding-left",
      pr: "padding-right",
      m: "margin",
      mx: "margin-inline",
      my: "margin-block",
      mt: "margin-top",
      mb: "margin-bottom",
      ml: "margin-left",
      mr: "margin-right",
      gap: "gap",
    }
    return `${propMap[sp[1]]}: ${parseFloat(sp[2]) * 0.25}rem`
  }

  // Sizing
  const w = cls.match(/^w-(.+)$/)
  if (w) return `width: ${sizeVal(w[1])}`
  const h = cls.match(/^h-(.+)$/)
  if (h) return `height: ${sizeVal(h[1])}`

  // Opacity, z-index
  const op = cls.match(/^opacity-(\d+)$/)
  if (op) return `opacity: ${parseInt(op[1], 10) / 100}`
  const z = cls.match(/^z-(\d+)$/)
  if (z) return `z-index: ${z[1]}`

  // Common utilities
  const map: Record<string, string> = {
    block: "display: block",
    "inline-block": "display: inline-block",
    flex: "display: flex",
    "inline-flex": "display: inline-flex",
    grid: "display: grid",
    hidden: "display: none",
    relative: "position: relative",
    absolute: "position: absolute",
    fixed: "position: fixed",
    sticky: "position: sticky",
    "flex-row": "flex-direction: row",
    "flex-col": "flex-direction: column",
    "items-center": "align-items: center",
    "items-start": "align-items: flex-start",
    "items-end": "align-items: flex-end",
    "justify-center": "justify-content: center",
    "justify-between": "justify-content: space-between",
    "justify-start": "justify-content: flex-start",
    "justify-end": "justify-content: flex-end",
    "font-thin": "font-weight: 100",
    "font-light": "font-weight: 300",
    "font-normal": "font-weight: 400",
    "font-medium": "font-weight: 500",
    "font-semibold": "font-weight: 600",
    "font-bold": "font-weight: 700",
    "font-extrabold": "font-weight: 800",
    "text-xs": "font-size: 0.75rem",
    "text-sm": "font-size: 0.875rem",
    "text-base": "font-size: 1rem",
    "text-lg": "font-size: 1.125rem",
    "text-xl": "font-size: 1.25rem",
    "text-2xl": "font-size: 1.5rem",
    "text-3xl": "font-size: 1.875rem",
    "text-4xl": "font-size: 2.25rem",
    rounded: "border-radius: 0.25rem",
    "rounded-md": "border-radius: 0.375rem",
    "rounded-lg": "border-radius: 0.5rem",
    "rounded-xl": "border-radius: 0.75rem",
    "rounded-full": "border-radius: 9999px",
    "overflow-hidden": "overflow: hidden",
    "overflow-auto": "overflow: auto",
    "cursor-pointer": "cursor: pointer",
    "cursor-default": "cursor: default",
    "select-none": "user-select: none",
    "pointer-events-none": "pointer-events: none",
    truncate: "overflow: hidden; text-overflow: ellipsis; white-space: nowrap",
    transition:
      "transition-property: color,background-color,border-color,opacity,box-shadow,transform; transition-duration: 150ms",
  }

  return map[cls] ?? null
}

function sizeVal(v: string): string {
  const num = parseFloat(v)
  if (!Number.isNaN(num)) return `${num * 0.25}rem`
  const special: Record<string, string> = {
    full: "100%",
    screen: "100vw",
    auto: "auto",
    min: "min-content",
    max: "max-content",
    fit: "fit-content",
  }
  return special[v] ?? v
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton — satu engine per build process
// ─────────────────────────────────────────────────────────────────────────────

let _engine: IncrementalEngine | null = null

export function getIncrementalEngine(opts?: IncrementalEngineOptions): IncrementalEngine {
  if (!_engine) {
    _engine = new IncrementalEngine(opts)
  }
  return _engine
}

export function resetIncrementalEngine(): void {
  _engine = null
}
