import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const MASSIVE_SCRIPT = path.join(ROOT, "scripts/benchmark/massive.mjs")
const BENCH_ROOT = "packages/runtime/src"

function runMassiveBenchmark(extraArgs = []) {
  const output = execFileSync(process.execPath, [MASSIVE_SCRIPT, `--root=${BENCH_ROOT}`, ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  })
  return JSON.parse(output)
}

function assertMassiveShape(result) {
  assert.equal(typeof result, "object")
  assert.equal(typeof result.root, "string")
  assert.equal(typeof result.files, "number")
  assert.equal(typeof result.uniqueClasses, "number")
  assert.equal(typeof result.timingsMs, "object")
  assert.equal(typeof result.timingsMs.scan, "number")
  assert.equal(typeof result.timingsMs.analyze, "number")
  assert.equal(typeof result.timingsMs.engineBuildNoCss, "number")
  assert.equal(typeof result.memoryMb, "object")
  assert.equal(typeof result.memoryMb.rss, "number")
  assert.equal(typeof result.memoryMb.heapUsed, "number")
  assert.equal(typeof result.generatedAt, "string")
}

describe("bench:massive v5 compatibility", () => {
  test("supports --top and returns expected JSON shape", () => {
    const result = runMassiveBenchmark(["--top=5"])
    assertMassiveShape(result)
  })

  test("supports legacy --topN alias", () => {
    const result = runMassiveBenchmark(["--topN=5"])
    assertMassiveShape(result)
  })
})
