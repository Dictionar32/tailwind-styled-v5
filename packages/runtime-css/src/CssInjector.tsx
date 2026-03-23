/**
 * tailwind-styled-v4 — CSS Injector (React Server Component)
 *
 * Inject CSS yang sudah di-generate per-route langsung ke <head>.
 * Dipakai di Next.js App Router layout atau page.
 *
 * Di server component — inject inline CSS, zero client JS.
 * Streaming friendly — CSS di-emit bersamaan dengan HTML.
 *
 * Usage:
 *   // app/layout.tsx
 *   import { TwCssInjector } from "tailwind-styled-v4/css"
 *   export default function Layout({ children }) {
 *     return <html><head><TwCssInjector/></head><body>{children}</body></html>
 *   }
 */

import fs from "node:fs"
import path from "node:path"
import React from "react"

interface CssInjectorProps {
  /** Override CSS directory. Default: .next/static/css/tw */
  cssDir?: string
  /** Specific route to inject. Default: auto-detect dari headers */
  route?: string
  /** Inject global CSS juga. Default: true */
  includeGlobal?: boolean
  /** Minify inline CSS. Default: true */
  minify?: boolean
  /** Add <link> tag instead of inline <style> untuk cached CSS */
  asLink?: boolean
}

/**
 * Server Component — inject route-specific CSS into <head>.
 * No client JS, no hydration overhead.
 */
export async function TwCssInjector({
  cssDir,
  route,
  includeGlobal = true,
  minify = true,
  asLink = false,
}: CssInjectorProps): Promise<React.ReactElement> {
  const resolvedDir = cssDir ?? path.join(process.cwd(), ".next", "static", "css", "tw")

  const cssChunks: string[] = []

  // 1. Global CSS (base styles, reset)
  if (includeGlobal) {
    const globalCss = loadCssFile(path.join(resolvedDir, "_global.css"))
    if (globalCss) cssChunks.push(globalCss)
  }

  // 2. Route-specific CSS
  const targetRoute = route ?? "/"
  const routeFile = routeToFilename(targetRoute)
  const routeCss = loadCssFile(path.join(resolvedDir, routeFile))
  if (routeCss) cssChunks.push(routeCss)

  if (cssChunks.length === 0) return React.createElement(React.Fragment, null)

  const combined = cssChunks.join("\n")
  const final = minify ? minifyCss(combined) : combined

  if (asLink) {
    // Return <link> tag — CSS cached by browser
    return React.createElement("link", {
      rel: "stylesheet",
      href: `/_next/static/css/tw/${routeFile}`,
      crossOrigin: "anonymous",
    })
  }

  // Inline <style> — zero network request, fastest FCP
  return React.createElement("style", {
    dangerouslySetInnerHTML: { __html: final },
    "data-tw-route": targetRoute,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook for client components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight hook to get current route's CSS classes.
 * Useful for dynamic class injection in client components.
 *
 * Returns empty string on server (SSR) — CSS already injected by TwCssInjector.
 */
export function useTwClasses(classes: string): string {
  // In client environment, return classes as-is
  // CSS is already handled by TwCssInjector at server level
  return classes
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadCssFile(filepath: string): string | null {
  try {
    if (fs.existsSync(filepath)) {
      return fs.readFileSync(filepath, "utf-8")
    }
  } catch {
    // file not found or unreadable
  }
  return null
}

function routeToFilename(route: string): string {
  if (route === "/") return "index.css"
  if (route === "__global") return "_global.css"
  return `${route.replace(/^\//, "").replace(/\//g, "_")}.css`
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*{\s*/g, "{")
    .replace(/\s*}\s*/g, "}")
    .replace(/\s*;\s*/g, ";")
    .trim()
}
