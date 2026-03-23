/**
 * tailwind-styled-v4 — Route CSS Collector
 *
 * Mengumpulkan Tailwind classes per-route sehingga setiap halaman
 * hanya memuat CSS yang benar-benar dipakai.
 *
 * Tailwind default: ~300kb global CSS
 * Route CSS: ~2–10kb per halaman
 *
 * Cara kerja:
 * 1. Setiap file yang di-transform oleh compiler melaporkan classnya
 * 2. Collector memetakan file → route
 * 3. Di akhir build, CSS di-generate per route
 *
 * File structure output:
 *   .next/static/css/
 *     _global.css        ← base + reset (sekali load)
 *     app/page.css       ← hanya class yang dipakai di /
 *     app/about/page.css ← hanya class untuk /about
 *     app/dashboard/...
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteClassMap {
  /** filepath → array of tw classes */
  files: Map<string, Set<string>>
  /** route → Set of files yang dipakai */
  routes: Map<string, Set<string>>
  /** Global classes (di-load semua route) */
  global: Set<string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton collector (per build)
// ─────────────────────────────────────────────────────────────────────────────

let _collector: RouteClassMap = {
  files: new Map(),
  routes: new Map(),
  global: new Set(),
}

/**
 * Register classes dari sebuah file setelah compiler transform.
 * Dipanggil oleh turbopackLoader/webpackLoader setelah setiap file di-transform.
 */
export function registerFileClasses(filepath: string, classes: string[]): void {
  if (!_collector.files.has(filepath)) {
    _collector.files.set(filepath, new Set())
  }
  const fileSet = _collector.files.get(filepath)!
  classes.forEach((c) => fileSet.add(c))

  // Auto-detect route dari filepath
  const route = fileToRoute(filepath)
  if (route) {
    if (!_collector.routes.has(route)) {
      _collector.routes.set(route, new Set())
    }
    _collector.routes.get(route)!.add(filepath)
  }
}

/**
 * Register global classes (base styles, layout, dsb.)
 * Global classes dimuat di semua route.
 */
export function registerGlobalClasses(classes: string[]): void {
  classes.forEach((c) => _collector.global.add(c))
}

/**
 * Get all classes for a specific route (termasuk global)
 */
export function getRouteClasses(route: string): Set<string> {
  const result = new Set<string>(_collector.global)

  // Tambahkan classes dari semua file yang terkait route ini
  const routeFiles = _collector.routes.get(route) ?? new Set()
  for (const filepath of routeFiles) {
    const fileClasses = _collector.files.get(filepath) ?? new Set()
    fileClasses.forEach((c) => result.add(c))
  }

  return result
}

/**
 * Get all routes yang sudah ter-register
 */
export function getAllRoutes(): string[] {
  return Array.from(_collector.routes.keys()).sort()
}

/**
 * Get complete map (untuk build-time generation)
 */
export function getCollector(): RouteClassMap {
  return _collector
}

/**
 * Reset collector (start of each build)
 */
export function resetCollector(): void {
  _collector = {
    files: new Map(),
    routes: new Map(),
    global: new Set(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File → Route mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Konversi filepath ke Next.js App Router route.
 *
 * /src/app/page.tsx           → /
 * /src/app/about/page.tsx     → /about
 * /src/app/dashboard/page.tsx → /dashboard
 * /src/components/Button.tsx  → null (shared component, goes to global)
 * /src/app/layout.tsx         → __layout (global)
 */
export function fileToRoute(filepath: string): string | null {
  const normalized = filepath.replace(/\\/g, "/")

  // Layout files → global
  if (
    normalized.includes("/layout.") ||
    normalized.includes("/loading.") ||
    normalized.includes("/error.")
  ) {
    return "__global"
  }

  // Page files in App Router
  const pageMatch = normalized.match(/\/app\/(.+?)\/page\.[tj]sx?$/)
  if (pageMatch) return `/${pageMatch[1]}`

  const rootPage = normalized.match(/\/app\/page\.[tj]sx?$/)
  if (rootPage) return "/"

  // Pages Router
  const pagesMatch = normalized.match(/\/pages\/(.+?)\.[tj]sx?$/)
  if (pagesMatch) {
    const route = pagesMatch[1].replace(/\/index$/, "")
    return `/${route}`
  }

  // Shared components → global
  if (
    normalized.includes("/components/") ||
    normalized.includes("/ui/") ||
    normalized.includes("/shared/")
  ) {
    return "__global"
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary for logging
// ─────────────────────────────────────────────────────────────────────────────

export function getCollectorSummary(): string {
  const routes = getAllRoutes()
  const totalFiles = _collector.files.size
  const totalGlobal = _collector.global.size

  const lines = [
    `[tailwind-styled-v4] Route CSS Summary:`,
    `  Files processed: ${totalFiles}`,
    `  Global classes: ${totalGlobal}`,
    `  Routes found: ${routes.length}`,
    ...routes.map((r) => {
      const cls = getRouteClasses(r).size
      return `    ${r} → ${cls} classes`
    }),
  ]

  return lines.join("\n")
}
