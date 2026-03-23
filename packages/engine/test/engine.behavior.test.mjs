import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { createEngine } from "../dist/index.js"

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tw-engine-test-"))
}

function writeSource(root, content, file = "index.tsx") {
  fs.writeFileSync(path.join(root, file), content)
}

test("tailwindConfigPath invalid path throws during build", async () => {
  const root = createTempProject()
  writeSource(root, `export const x = <div className=\"text-red-500\" />`)

  const engine = await createEngine({
    root,
    tailwindConfigPath: "./missing-tailwind-config.js",
  })

  await assert.rejects(
    () => engine.build(),
    (error) => {
      assert.match(error.message, /tailwindConfigPath not found/)
      return true
    }
  )
})

test("plugin transformClasses can return empty array and override class list", async () => {
  const root = createTempProject()
  writeSource(root, `export const x = <div className=\"text-red-500 bg-blue-500\" />`)

  const engine = await createEngine({
    root,
    plugins: [
      {
        name: "clear-classes",
        transformClasses() {
          return []
        },
      },
    ],
  })

  const result = await engine.build()
  assert.equal(result.mergedClassList, "")
  assert.equal(result.css, "")
})

test("plugin onError is called when build lifecycle throws", async () => {
  const root = createTempProject()
  writeSource(root, `export const x = <div className=\"text-red-500\" />`)

  const seen = []
  const engine = await createEngine({
    root,
    plugins: [
      {
        name: "throw-before-build",
        beforeBuild() {
          throw new Error("beforeBuild failed")
        },
        onError(error) {
          seen.push(error.message)
        },
      },
    ],
  })

  await assert.rejects(() => engine.build(), /beforeBuild failed/)
  assert.deepEqual(seen, ["beforeBuild failed"])
})


test("watch emits error event when plugin fails during incremental build", async () => {
  const root = createTempProject()
  const filePath = path.join(root, "index.tsx")
  writeSource(root, `export const x = <div className=\"text-red-500\" />`)

  let shouldFail = false
  const events = []

  const engine = await createEngine({
    root,
    plugins: [
      {
        name: "flaky-transform",
        transformClasses(classes) {
          if (shouldFail) throw new Error("transform failed in watch")
          return classes
        },
      },
    ],
  })

  const watcher = await engine.watch((event) => {
    events.push(event)
  }, { debounceMs: 20 })

  await new Promise((resolve) => setTimeout(resolve, 120))

  shouldFail = true
  fs.writeFileSync(filePath, `export const x = <div className=\"text-blue-500\" />`)

  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "error" && /transform failed in watch/.test(event.error))) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  watcher.close()

  assert.ok(events.some((event) => event.type === "initial"))
  assert.ok(events.some((event) => event.type === "error" && /transform failed in watch/.test(event.error)))
})
