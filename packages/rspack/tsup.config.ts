import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index:  "src/index.ts",
    loader: "src/loader.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  // Hanya runtime Node built-ins & Tailwind yang external.
  external: [
    "fs",
    "path",
    "crypto",
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
    "@tailwind-styled/shared",
  ],
  esbuildOptions(options) {
    // Skip platform-specific native bindings — tidak bisa di-bundle
    options.external = [...(options.external ?? []), "*.node"]
  },
  tsconfig: "tsconfig.json",
})
