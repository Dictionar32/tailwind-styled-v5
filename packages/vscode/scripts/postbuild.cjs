#!/usr/bin/env node
"use strict"
const fs = require("fs")
const path = require("path")

const src = path.resolve(__dirname, "../../../scripts/v48/lsp.mjs")
const dst = path.resolve(__dirname, "../dist/lsp.mjs")

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst)
  console.log("[postbuild] lsp.mjs → dist/lsp.mjs ✅")
} else {
  console.warn("[postbuild] scripts/v48/lsp.mjs not found, skipping")
}
