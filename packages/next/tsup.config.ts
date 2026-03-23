import { defineConfig } from "tsup"

export default defineConfig({
  // Bundle index + loaders sebagai entry points terpisah
  // sehingga require.resolve("./turbopackLoader") resolve ke file di dist
  entry: {
    index:           "src/index.ts",
    turbopackLoader: "src/turbopackLoader.ts",
    webpackLoader:   "src/webpackLoader.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  external: [
    // Framework & Node built-ins — tetap external
    "next",
    "fs",
    "path",
    "crypto",
    // Loader entry points — resolve ke file dist terpisah
    "./turbopackLoader",
    "./webpackLoader",
    // Tailwind runtime & postcss — native .node bindings tidak bisa di-bundle
    "tailwindcss",
    "@tailwindcss/postcss",
    "postcss",
    "tailwind-merge",
  ],
  // Force bundle internal @tailwind-styled packages — user tidak perlu instal terpisah.
  // tsup by default meng-external semua dependencies di package.json.
  noExternal: [
    "@tailwind-styled/compiler",
    "@tailwind-styled/plugin",
    "@tailwind-styled/shared",
  ],
  esbuildOptions(options) {
    // Skip platform-specific native bindings — tidak bisa di-bundle
    options.external = [...(options.external ?? []), "*.node"]
  },
  tsconfig: "tsconfig.json",
})
