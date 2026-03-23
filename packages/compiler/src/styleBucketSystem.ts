/**
 * tailwind-styled-v4 — Style Bucket System
 *
 * Setiap CSS rule masuk ke "bucket" berdasarkan tipe property-nya.
 * Bucket di-emit dalam urutan yang selalu sama → CSS order stabil
 * meskipun rule di-generate dari banyak file secara incremental.
 *
 * Tanpa bucket system:
 *   .tw-color { color: blue }   ← dari file A
 *   .tw-flex  { display: flex } ← dari file B
 *   .tw-color2 { color: red }   ← dari file C
 *   → urutan output bergantung urutan file di-process = TIDAK STABIL
 *
 * Dengan bucket system:
 *   /* reset *\/
 *   /* layout *\/   → display, position, flex, grid, overflow
 *   /* spacing *\/  → margin, padding, gap, inset
 *   /* sizing *\/   → width, height, max/min-width/height
 *   /* typography *\/ → font-size, font-weight, line-height, text-*
 *   /* visual *\/   → color, background, border, shadow, opacity
 *   /* interaction *\/ → cursor, pointer-events, user-select, transition
 *   /* responsive *\/ → @media queries (selalu di akhir)
 *   → SELALU urutan ini, terlepas dari urutan file
 *
 * Keuntungan utama:
 *  1. CSS output deterministic antar build (reproducible builds)
 *  2. Specificity conflict sangat kecil — base selalu lebih awal dari responsive
 *  3. Debug lebih mudah — tahu section mana rule berada
 *
 * Integrasi:
 *   import { BucketEngine, bucketSort } from "./styleBucketSystem"
 *
 *   const engine = new BucketEngine()
 *   engine.add(styleNode)
 *   const css = engine.emit()
 */

import type { StyleNode } from "./incrementalEngine"

// ─────────────────────────────────────────────────────────────────────────────
// Bucket Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 8 bucket utama + 1 bucket "unknown" untuk fallback.
 * Urutan angka = urutan emit di CSS output.
 */
export type StyleBucket =
  | "reset" // 0 — *, box-sizing, root
  | "layout" // 1 — display, position, flex, grid, overflow, z-index
  | "spacing" // 2 — margin, padding, gap, inset, top/right/bottom/left
  | "sizing" // 3 — width, height, max/min variants
  | "typography" // 4 — font-size, font-weight, line-height, letter-spacing, text-align
  | "visual" // 5 — color, background, border, border-radius, shadow, opacity, outline
  | "interaction" // 6 — cursor, pointer-events, user-select, transition, transform, animation
  | "responsive" // 7 — @media queries (semua)
  | "unknown" // 8 — fallback untuk property yang tidak dikenal

const BUCKET_ORDER: StyleBucket[] = [
  "reset",
  "layout",
  "spacing",
  "sizing",
  "typography",
  "visual",
  "interaction",
  "responsive",
  "unknown",
]

// ─────────────────────────────────────────────────────────────────────────────
// Property → Bucket Mapping
// ─────────────────────────────────────────────────────────────────────────────

/** Map dari CSS property prefix/exact ke bucket */
const PROPERTY_BUCKET_MAP: Record<string, StyleBucket> = {
  // Layout
  display: "layout",
  position: "layout",
  flex: "layout",
  "flex-direction": "layout",
  "flex-wrap": "layout",
  "flex-grow": "layout",
  "flex-shrink": "layout",
  "flex-basis": "layout",
  grid: "layout",
  "grid-template": "layout",
  "grid-column": "layout",
  "grid-row": "layout",
  "align-items": "layout",
  "align-self": "layout",
  "align-content": "layout",
  "justify-content": "layout",
  "justify-items": "layout",
  "justify-self": "layout",
  "place-items": "layout",
  "place-content": "layout",
  overflow: "layout",
  "overflow-x": "layout",
  "overflow-y": "layout",
  "z-index": "layout",
  float: "layout",
  clear: "layout",
  visibility: "layout",

  // Spacing
  padding: "spacing",
  "padding-top": "spacing",
  "padding-bottom": "spacing",
  "padding-left": "spacing",
  "padding-right": "spacing",
  "padding-inline": "spacing",
  "padding-block": "spacing",
  margin: "spacing",
  "margin-top": "spacing",
  "margin-bottom": "spacing",
  "margin-left": "spacing",
  "margin-right": "spacing",
  "margin-inline": "spacing",
  "margin-block": "spacing",
  gap: "spacing",
  "column-gap": "spacing",
  "row-gap": "spacing",
  inset: "spacing",
  "inset-inline": "spacing",
  "inset-block": "spacing",
  top: "spacing",
  bottom: "spacing",
  left: "spacing",
  right: "spacing",

  // Sizing
  width: "sizing",
  height: "sizing",
  "max-width": "sizing",
  "min-width": "sizing",
  "max-height": "sizing",
  "min-height": "sizing",
  "aspect-ratio": "sizing",

  // Typography
  "font-size": "typography",
  "font-weight": "typography",
  "font-family": "typography",
  "font-style": "typography",
  "line-height": "typography",
  "letter-spacing": "typography",
  "text-align": "typography",
  "text-decoration": "typography",
  "text-transform": "typography",
  "text-overflow": "typography",
  "white-space": "typography",
  "word-break": "typography",
  "word-wrap": "typography",
  "vertical-align": "typography",

  // Visual
  color: "visual",
  background: "visual",
  "background-color": "visual",
  "background-image": "visual",
  "background-size": "visual",
  "background-position": "visual",
  "background-repeat": "visual",
  border: "visual",
  "border-top": "visual",
  "border-bottom": "visual",
  "border-left": "visual",
  "border-right": "visual",
  "border-inline": "visual",
  "border-block": "visual",
  "border-color": "visual",
  "border-width": "visual",
  "border-style": "visual",
  "border-radius": "visual",
  "box-shadow": "visual",
  opacity: "visual",
  outline: "visual",
  "outline-color": "visual",
  "outline-width": "visual",
  fill: "visual",
  stroke: "visual",
  "text-shadow": "visual",
  "mix-blend-mode": "visual",
  "object-fit": "visual",
  "object-position": "visual",

  // Interaction
  cursor: "interaction",
  "pointer-events": "interaction",
  "user-select": "interaction",
  transition: "interaction",
  "transition-property": "interaction",
  "transition-duration": "interaction",
  "transition-timing-function": "interaction",
  "transition-delay": "interaction",
  transform: "interaction",
  translate: "interaction",
  rotate: "interaction",
  scale: "interaction",
  animation: "interaction",
  "will-change": "interaction",
  "scroll-behavior": "interaction",
  "scroll-snap-type": "interaction",

  // Reset (jarang dipakai langsung tapi handle untuk completeness)
  "box-sizing": "reset",
  appearance: "reset",
  all: "reset",
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucket Classifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify satu StyleNode ke bucket yang tepat.
 *
 * Priority:
 * 1. Jika ada modifier @media → "responsive" (selalu paling akhir)
 * 2. Cek declaration property → lookup PROPERTY_BUCKET_MAP
 * 3. Fallback ke "unknown"
 */
export function classifyNode(node: StyleNode): StyleBucket {
  // Media queries selalu masuk responsive bucket
  if (node.modifier?.startsWith("@")) return "responsive"

  // Extract property dari declaration "property: value; ..." (support multi-prop)
  const declarations = node.declaration
    .split(";")
    .map((d: string) => d.trim())
    .filter(Boolean)
  const firstProp = declarations[0]?.split(":")[0]?.trim()

  if (!firstProp) return "unknown"

  // Exact match
  if (PROPERTY_BUCKET_MAP[firstProp]) return PROPERTY_BUCKET_MAP[firstProp]

  // Prefix match — untuk shorthand variants
  for (const [prefix, bucket] of Object.entries(PROPERTY_BUCKET_MAP)) {
    if (firstProp.startsWith(prefix)) return bucket
  }

  return "unknown"
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucket Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface BucketStats {
  totalNodes: number
  perBucket: Record<StyleBucket, number>
}

/**
 * BucketEngine — menyimpan dan emit CSS dalam urutan bucket yang stabil.
 *
 * @example
 * const engine = new BucketEngine()
 * for (const node of styleNodes) engine.add(node)
 * const css = engine.emit()
 */
export class BucketEngine {
  private buckets: Map<StyleBucket, Map<string, StyleNode>>

  constructor() {
    this.buckets = new Map()
    for (const b of BUCKET_ORDER) {
      this.buckets.set(b, new Map())
    }
  }

  /**
   * Tambah StyleNode ke bucket yang tepat.
   * Idempotent — atomic class yang sama tidak akan duplikat.
   */
  add(node: StyleNode): void {
    const bucket = classifyNode(node)
    this.buckets.get(bucket)!.set(node.atomicClass, node)
  }

  /**
   * Hapus node dari bucket (untuk incremental update).
   */
  remove(atomicClass: string): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.delete(atomicClass)) break
    }
  }

  /**
   * Apply CssDiff dari incremental engine.
   */
  applyDiff(diff: { added: StyleNode[]; removed: string[] }): void {
    for (const node of diff.added) this.add(node)
    for (const cls of diff.removed) this.remove(cls)
  }

  /**
   * Emit seluruh CSS dalam urutan bucket yang deterministic.
   *
   * @param comments - Tambahkan komentar section per bucket. Default: true
   * @returns CSS string yang siap di-write ke file
   */
  emit(comments = true): string {
    const sections: string[] = []

    for (const bucketName of BUCKET_ORDER) {
      const nodes = this.buckets.get(bucketName)!
      if (nodes.size === 0) continue

      const rules: string[] = []

      for (const node of nodes.values()) {
        rules.push(nodeToCSS(node))
      }

      if (rules.length === 0) continue

      if (comments) {
        sections.push(`/* ── ${bucketName} ── */`)
      }
      sections.push(...rules)
    }

    return sections.join("\n")
  }

  /**
   * Emit dengan @layer CSS untuk native browser layering.
   * Lebih powerful — browser respects layer order untuk specificity.
   *
   * @example output:
   * @layer tw-layout, tw-spacing, tw-visual, tw-responsive;
   * @layer tw-layout { .tw-a1 { display: flex } }
   */
  emitLayered(): string {
    // Layer declaration
    const layerNames = BUCKET_ORDER.filter(
      (b) => b !== "unknown" && this.buckets.get(b)!.size > 0
    ).map((b) => `tw-${b}`)

    if (layerNames.length === 0) return ""

    const parts: string[] = [`@layer ${layerNames.join(", ")};`, ""]

    for (const bucketName of BUCKET_ORDER) {
      const nodes = this.buckets.get(bucketName)!
      if (nodes.size === 0) continue

      const rules = Array.from(nodes.values()).map(nodeToCSS).join("\n  ")
      parts.push(`@layer tw-${bucketName} {\n  ${rules}\n}`)
    }

    return parts.join("\n")
  }

  /** Semua nodes dari semua bucket (untuk full registry access) */
  allNodes(): StyleNode[] {
    const all: StyleNode[] = []
    for (const bucket of this.buckets.values()) {
      for (const node of bucket.values()) {
        all.push(node)
      }
    }
    return all
  }

  /** Stats per bucket */
  stats(): BucketStats {
    const perBucket = {} as Record<StyleBucket, number>
    let total = 0
    for (const [name, nodes] of this.buckets) {
      perBucket[name] = nodes.size
      total += nodes.size
    }
    return { totalNodes: total, perBucket }
  }

  /** Clear semua bucket */
  clear(): void {
    for (const bucket of this.buckets.values()) {
      bucket.clear()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bucketSort — utility function untuk sort array StyleNodes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort array StyleNodes dalam urutan bucket.
 * Berguna untuk one-off sorting tanpa perlu BucketEngine instance.
 *
 * @example
 * const sorted = bucketSort(allNodes)
 * const css = sorted.map(nodeToCSS).join("\n")
 */
export function bucketSort(nodes: StyleNode[]): StyleNode[] {
  const bucketIndex = Object.fromEntries(BUCKET_ORDER.map((b, i) => [b, i])) as Record<
    StyleBucket,
    number
  >

  return [...nodes].sort((a, b) => {
    const ai = bucketIndex[classifyNode(a)]
    const bi = bucketIndex[classifyNode(b)]
    return ai - bi
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS generation helpers
// ─────────────────────────────────────────────────────────────────────────────

function nodeToCSS(node: StyleNode): string {
  const { atomicClass, declaration, modifier } = node

  if (!modifier) {
    return `.${atomicClass}{${declaration}}`
  }

  if (modifier.startsWith("@")) {
    return `${modifier}{.${atomicClass}{${declaration}}}`
  }

  return `.${atomicClass}${modifier}{${declaration}}`
}

// ─────────────────────────────────────────────────────────────────────────────
// CSSConflictDetector — dev-mode helper
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictWarning {
  property: string
  classes: string[]
  bucket: StyleBucket
  message: string
}

/**
 * Detect potential CSS conflicts dalam satu set StyleNodes.
 * Hanya untuk dev mode — tidak perlu run di production.
 *
 * Conflict = dua node dengan property yang sama tapi value berbeda
 * di bucket yang sama (bukan responsive override).
 *
 * @example
 * const warnings = detectConflicts(nodes)
 * if (warnings.length) console.warn(warnings)
 */
export function detectConflicts(nodes: StyleNode[]): ConflictWarning[] {
  // property+modifier → node
  const seen = new Map<string, StyleNode>()
  const warnings: ConflictWarning[] = []

  for (const node of nodes) {
    // Skip responsive — by design override base
    if (node.modifier?.startsWith("@")) continue

    const firstProp = node.declaration.split(":")[0]?.trim()
    if (!firstProp) continue

    const key = `${firstProp}::${node.modifier ?? ""}`
    const prev = seen.get(key)

    if (prev) {
      warnings.push({
        property: firstProp,
        classes: [prev.twClass, node.twClass],
        bucket: classifyNode(node),
        message: `Possible conflict: "${prev.twClass}" and "${node.twClass}" both set "${firstProp}"`,
      })
    } else {
      seen.set(key, node)
    }
  }

  return warnings
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton BucketEngine
// ─────────────────────────────────────────────────────────────────────────────

let _bucketEngine: BucketEngine | null = null

export function getBucketEngine(): BucketEngine {
  if (!_bucketEngine) _bucketEngine = new BucketEngine()
  return _bucketEngine
}

export function resetBucketEngine(): void {
  _bucketEngine = null
}
