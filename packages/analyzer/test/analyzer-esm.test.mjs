import assert from "node:assert/strict"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const analyzerUrl = pathToFileURL(path.join(ROOT, "packages/analyzer/dist/index.js")).href

describe("analyzer esm import", () => {
  test("analyzeWorkspace works via ESM export", async () => {
    const analyzer = await import(analyzerUrl)
    assert.equal(typeof analyzer.analyzeWorkspace, "function")
    assert.equal(typeof analyzer.classToCss, "function")

    const report = await analyzer.analyzeWorkspace(path.join(ROOT, "packages/runtime/src"), {
      classStats: { top: 3, frequentThreshold: 2 },
    })
    assert.ok(report.totalFiles >= 0)
    assert.ok(Array.isArray(report.classStats.top))

    const css = await analyzer.classToCss("opacity-0", { strict: true })
    assert.ok(css.declarations.includes("opacity: 0"))
  })
})
