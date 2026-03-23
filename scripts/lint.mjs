#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// Manual glob to avoid extra dependencies.
function findFiles(dir, exts = [".ts", ".tsx"]) {
  const results = []
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue
      const st = statSync(full)
      if (st.isDirectory()) results.push(...findFiles(full, exts))
      else if (exts.some((ext) => name.endsWith(ext))) results.push(full)
    }
  } catch {
    // skip unreadable directories
  }
  return results
}

const packagesDir = join(process.cwd(), "packages")
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const files = []
for (const pkg of packages) {
  const srcDir = join(packagesDir, pkg, "src")
  files.push(...findFiles(srcDir))
}
files.sort()

if (!files.length) {
  console.log("No files found to lint.")
  process.exit(0)
}

const requestedBatchSize = Number(process.env.OXLINT_BATCH_SIZE ?? 80)
const batchSize =
  Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
    ? Math.floor(requestedBatchSize)
    : 80

const oxlintScript = join(process.cwd(), "node_modules", "oxlint", "bin", "oxlint")

const totalBatches = Math.ceil(files.length / batchSize)
console.log(`Linting ${files.length} files with oxlint in ${totalBatches} batch(es)...`)

let hasFailure = false
for (let i = 0; i < files.length; i += batchSize) {
  const batchIndex = Math.floor(i / batchSize) + 1
  const batch = files.slice(i, i + batchSize)
  console.log(`Running batch ${batchIndex}/${totalBatches} (${batch.length} files)`)

  const result = spawnSync(process.execPath, [oxlintScript, ...batch], {
    stdio: "inherit",
  })

  if ((result.status ?? 1) !== 0) {
    hasFailure = true
  }
}

if (hasFailure) {
  process.exit(1)
}
