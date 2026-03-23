import { defineConfig } from "tsup"

export default defineConfig({
  entry: { plugin: "src/plugin.ts" },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  external: [
    // Framework & Node built-ins
    "vite",
    "path",
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
    "@tailwind-styled/engine",
    "@tailwind-styled/scanner",
    "@tailwind-styled/shared",
  ],
  esbuildOptions(options) {
    // Skip platform-specific native bindings — tidak bisa di-bundle
    options.external = [...(options.external ?? []), "*.node"]
  },
  tsconfig: "tsconfig.json",
  // Fix: suppress named+default exports warning — vite plugins are always named imports
  rollupOptions: {
    output: { exports: "named" },
  },
})
