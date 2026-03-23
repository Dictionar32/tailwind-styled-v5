import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    // Core
    index:           "src/index.ts",
    // Adapters
    next:            "../next/src/index.ts",
    turbopackLoader: "../next/src/turbopackLoader.ts",
    webpackLoader:   "../next/src/webpackLoader.ts",
    vite:            "../vite/src/plugin.ts",
    // Compiler
    compiler:        "../compiler/src/index.ts",
    // Preset
    preset:          "../preset/src/defaultPreset.ts",
    // Extras
    plugins:         "../plugin/src/index.ts",
    devtools:        "../devtools/src/index.tsx",
    animate:         "../animate/src/index.ts",
    theme:           "../theme/src/index.ts",
    css:             "../runtime-css/src/CssInjector.tsx",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  external: [
    // React
    "react",
    "react-dom",
    // Tailwind
    "tailwind-merge",
    "tailwindcss",
    "@tailwindcss/postcss",
    "postcss",
    // Next.js
    "next",
    // Vite
    "vite",
    // Node built-ins
    "fs",
    "path",
    "module",
    "os",
    "url",
    "crypto",
    "child_process",
    "worker_threads",
    "stream",
    "events",
    "util",
    "node:fs",
    "node:path",
    "node:module",
    "node:os",
    "node:url",
    "node:crypto",
    "node:child_process",
    "node:worker_threads",
    "node:stream",
    "node:events",
    "node:util",
    // Internal workspace packages — sudah di-bundle langsung dari src,
    // tapi kalau ada import antar-package di runtime harus external
    "@tailwind-styled/compiler",
    "@tailwind-styled/engine",
    "@tailwind-styled/scanner",
    "@tailwind-styled/plugin",
    "@tailwind-styled/animate",
    "@tailwind-styled/devtools",
    "@tailwind-styled/next",
    "@tailwind-styled/preset",
    "@tailwind-styled/runtime-css",
    "@tailwind-styled/theme",
    "@tailwind-styled/vite",
  ],
  treeshake: true,
  minify: false,
  banner: {
    js: "/* tailwind-styled-v4 v4 | MIT | https://github.com/dictionar32/tailwind-styled-v4 */",
  },
})
