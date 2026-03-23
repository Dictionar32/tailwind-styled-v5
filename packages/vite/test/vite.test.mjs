/**
 * Test suite: @tailwind-styled/vite
 * Plugin butuh Vite dev server — test verifikasi struktur dan exports
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const DIST = path.join(ROOT, "packages/vite/dist")
const SRC  = path.join(ROOT, "packages/vite/src")

describe("Dist files", () => {
  test("plugin.cjs ada", () => assert.ok(fs.existsSync(path.join(DIST, "plugin.cjs"))))
  test("plugin.js ada",  () => assert.ok(fs.existsSync(path.join(DIST, "plugin.js"))))
  test("plugin.d.ts ada",() => assert.ok(fs.existsSync(path.join(DIST, "plugin.d.ts"))))
})

describe("Source structure", () => {
  test("src/plugin.ts ada", () => {
    assert.ok(fs.existsSync(path.join(SRC, "plugin.ts")))
  })

  test("src/plugin.ts export tailwindStyled", () => {
    const src = fs.readFileSync(path.join(SRC, "plugin.ts"), "utf8")
    assert.ok(
      src.includes("export function tailwindStyled") ||
      src.includes("export function tailwindStyledPlugin") ||
      src.includes("export default"),
      "Harus ada export plugin function"
    )
  })

  test("src/plugin.ts pakai loader dari compiler", () => {
    const src = fs.readFileSync(path.join(SRC, "plugin.ts"), "utf8")
    assert.ok(
      src.includes("runLoaderTransform") || src.includes("@tailwind-styled/compiler"),
      "Harus menggunakan compiler"
    )
  })
})

describe("Package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/vite/package.json"), "utf8"))

  test("name benar", () => assert.ok(pkg.name.includes("vite")))
  test("main tersedia", () => assert.ok(pkg.main ?? pkg.exports))
  test("peer dep vite ada", () => {
    assert.ok(
      "vite" in (pkg.peerDependencies ?? {}),
      "vite harus ada di peerDependencies"
    )
  })
})
