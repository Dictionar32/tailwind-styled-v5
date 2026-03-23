#!/usr/bin/env node

import { buildMainProgram } from "./commands/program"
import { runCliMain } from "./utils/runtime"

await runCliMain({
  importMetaUrl: import.meta.url,
  buildProgram: buildMainProgram,
})
