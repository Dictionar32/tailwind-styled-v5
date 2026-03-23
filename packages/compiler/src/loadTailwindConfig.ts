/**
 * tailwind-styled-v4 — Tailwind Config Loader
 *
 * Auto-load tailwind config dari project.
 * Jika tidak ada → fallback ke defaultPreset (zero-config mode).
 *
 * Priority:
 *   1. tailwind.config.ts  (TypeScript)
 *   2. tailwind.config.js  (JavaScript)
 *   3. tailwind.config.mjs (ESM)
 *   4. defaultPreset       (fallback — zero-config)
 */

import fs from "node:fs"
import path from "node:path"

export type TailwindConfig = Record<string, any>

const CONFIG_FILES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
]

let _cachedConfig: TailwindConfig | null = null
let _cachedCwd: string = ""

/**
 * Load tailwind config. Cached per process.
 * Returns defaultPreset if no config found (zero-config mode).
 */
export function loadTailwindConfig(cwd = process.cwd()): TailwindConfig {
  // Cache invalidation
  if (_cachedConfig && _cachedCwd === cwd) return _cachedConfig

  _cachedCwd = cwd

  // Try each config file
  for (const file of CONFIG_FILES) {
    const fullPath = path.join(cwd, file)
    if (fs.existsSync(fullPath)) {
      try {
        // For .ts files, we need ts-node or pre-compiled version
        // In practice, Next.js/Vite already handle this via their config system
        const mod = require(fullPath)
        const config = mod.default ?? mod
        _cachedConfig = config
        console.log(`[tailwind-styled-v4] Using config: ${file}`)
        return config
      } catch {}
    }
  }

  // Zero-config fallback
  console.log("[tailwind-styled-v4] No tailwind config found → using built-in preset")
  const { defaultPreset } = require("../../preset/src/defaultPreset")
  _cachedConfig = defaultPreset
  return defaultPreset
}

/**
 * Get content paths dari config (atau default paths)
 */
export function getContentPaths(config: TailwindConfig, cwd = process.cwd()): string[] {
  const paths: string[] = []

  if (Array.isArray(config.content)) {
    for (const item of config.content) {
      if (typeof item === "string") paths.push(item)
      else if (typeof item === "object" && item.raw) {
        // inline content object — skip
      }
    }
    return paths
  }

  if (config.content?.files) {
    return config.content.files.filter((f: any) => typeof f === "string")
  }

  // Fallback: scan standard dirs
  return ["src", "app", "pages", "components"]
    .filter((d) => fs.existsSync(path.join(cwd, d)))
    .map((d) => `./${d}/**/*.{tsx,ts,jsx,js}`)
}

/**
 * Invalidate config cache (useful for watch mode)
 */
export function invalidateConfigCache(): void {
  _cachedConfig = null
  _cachedCwd = ""
}

/**
 * Check if project has zero-config setup (no user tailwind config)
 */
export function isZeroConfig(cwd = process.cwd()): boolean {
  return !CONFIG_FILES.some((f) => fs.existsSync(path.join(cwd, f)))
}

/**
 * Auto-generate tailwind.config.ts dan globals.css jika tidak ada
 * (dipanggil oleh CLI dan withTailwindStyled pada first run)
 */
export function bootstrapZeroConfig(cwd = process.cwd()): {
  generatedConfig: boolean
  generatedCss: boolean
} {
  let generatedConfig = false
  let generatedCss = false

  // Tailwind v4: CSS-first — tidak perlu tailwind.config.ts
  // Config dilakukan via CSS (@source, @theme, dsb.)
  generatedConfig = false

  // Generate globals.css if missing
  const cssPaths = [
    "src/app/globals.css",
    "app/globals.css",
    "src/index.css",
    "src/styles/globals.css",
  ]
  const hasGlobalCss = cssPaths.some((p) => fs.existsSync(path.join(cwd, p)))

  if (!hasGlobalCss) {
    const { defaultGlobalCss } = require("../../preset/src/defaultPreset")
    // Try to find app directory
    const appDir = fs.existsSync(path.join(cwd, "src/app"))
      ? "src/app"
      : fs.existsSync(path.join(cwd, "app"))
        ? "app"
        : "src"
    const cssPath = path.join(cwd, appDir, "globals.css")
    if (fs.existsSync(path.dirname(cssPath))) {
      fs.writeFileSync(cssPath, defaultGlobalCss)
      generatedCss = true
      console.log(`[tailwind-styled-v4] Generated ${cssPath}`)
    }
  }

  return { generatedConfig, generatedCss }
}
