#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { runAnalyzeCli } from "./analyze"
import { runExtractCli } from "./extract"
import { runInitCli } from "./init"
import { runSetupCli } from "./setup"
import { runMigrateCli } from "./migrate"
import { runScanCli } from "./scan"
import { runStatsCli } from "./stats"

const args = process.argv.slice(2)
const command = args[0]
const restArgs = args.slice(1)

type PluginInfo = {
  name: string
  description: string
  version: string
  tags: string[]
  official?: boolean
}

const HELP = `
tailwind-styled-v4 CLI (tw)

Unified commands (v4.3):
  tw plugin search <query>         Search plugins
  tw plugin list                   List registry plugins
  tw plugin install <name>         Install plugin package
  tw create <name> [--template=..] Create project from template
  tw dashboard [--port=3000]       Start dashboard server
  tw test [--watch]                Run test command shortcut
  tw storybook [--port=6006]       Launch Storybook dev server
  tw storybook --variants='{...}'  Enumerate variant matrix
  tw preflight [--fix] [--json]    Environment preflight check
  tw code --docs                   Show VS Code extension docs URL
  tw studio [--project=.]          Open platform studio mode
  tw deploy [name]                 Publish to registry (--registry=URL --dry-run)
  tw registry <serve|list|info>    Local component registry server
  tw ai "prompt" [--provider=...]   Generate component (anthropic/openai/ollama)
  tw sync <init|pull|push|diff>    Token sync (DTCG) + remote URL (--from=url --to-url=url)
  tw sync figma <pull|push|diff>   Figma Variables API sync
  tw audit                         Emit project audit JSON summary
  tw share <name>                  Print share payload template
  tw parse <file>                  Parse file with Oxc-first prototype
  tw transform <file> [out]        Transform file with Oxc-first prototype
  tw minify <file>                 Minify file with Oxc-first prototype
  tw shake <cssFile>               Remove sentinel-unused CSS rules
  tw lint [dir] [workers]          Lint classes (--rules=file, --no-exit-0, --severity=)
  tw format <file> [--write]       Formatter prototype
  tw lsp                           Start LSP prototype
  tw benchmark                     Write toolchain benchmark snapshot
  tw optimize <file>               Compile-time optimization prototype
  tw split [root] [outDir]         Route-based CSS chunk prototype
  tw critical <html> <css>         Critical CSS extraction prototype
  tw cache <enable|status> [arg]   Remote cache prototype controls
  tw cluster <init|build> [n]      Distributed build cluster prototype
  tw adopt <feature> [project]     Incremental adoption prototype
  tw metrics [port]                Real-time metrics server prototype

Existing commands:
  tw setup [--next|--vite] [--yes] [--dry-run]  Auto-setup project (recommended)
  tw init [dir]
  tw scan [dir]
  tw migrate [dir] [--dry-run|--wizard]
  tw analyze [dir]
  tw stats [dir]
  tw extract [dir] [--write]
`

function runShellCommand(binary: string, cmdArgs: string[]): void {
  const child = spawn(binary, cmdArgs, { stdio: "inherit" })
  child.on("exit", (code) => process.exit(code ?? 0))
}

function readFlag(name: string, argv: string[]): string | null {
  const raw = argv.find((arg) => arg.startsWith(`--${name}=`))
  return raw ? raw.split("=").slice(1).join("=") : null
}

function loadRegistry(): PluginInfo[] {
  const registryPath = path.resolve(process.cwd(), "packages/plugin-registry/registry.json")
  const raw = fs.readFileSync(registryPath, "utf8")
  const data = JSON.parse(raw) as { official: PluginInfo[]; community: PluginInfo[] }
  return [
    ...data.official.map((item) => ({ ...item, official: true })),
    ...data.community.map((item) => ({ ...item, official: false })),
  ]
}

function enumerateVariantProps(matrix: Record<string, Array<string | number | boolean>>) {
  const keys = Object.keys(matrix)
  if (keys.length === 0) return [{}]
  const result: Array<Record<string, string | number | boolean>> = []

  function walk(index: number, current: Record<string, string | number | boolean>) {
    if (index >= keys.length) {
      result.push({ ...current })
      return
    }
    const key = keys[index]
    const values = matrix[key] ?? []
    for (const value of values) {
      current[key] = value
      walk(index + 1, current)
    }
  }

  walk(0, {})
  return result
}

async function runUnifiedCommand(): Promise<boolean> {
  if (command === "create") {
    const createMod = await import("./createApp")
    process.argv = [process.argv[0], process.argv[1], ...restArgs]
    await createMod.main()
    return true
  }

  if (command === "plugin") {
    const subcommand = restArgs[0]
    const pluginArgs = restArgs.slice(1)

    // Sprint 10+: update-check and verify subcommands
    if (subcommand === "update-check") {
      const registryScript = path.resolve(
        __dirname,
        "../../../packages/plugin-registry/dist/cli.js"
      )
      const fallbackScript = path.resolve(process.cwd(), "packages/plugin-registry/dist/cli.js")
      const script = fs.existsSync(registryScript) ? registryScript : fallbackScript
      runShellCommand(process.execPath, [script, "update-check"])
      return true
    }
    if (subcommand === "verify") {
      const pkgName = pluginArgs[0]
      if (!pkgName) {
        console.error("Usage: tw plugin verify <package-name>")
        process.exit(1)
      }
      const registryScript = path.resolve(
        __dirname,
        "../../../packages/plugin-registry/dist/cli.js"
      )
      const fallbackScript = path.resolve(process.cwd(), "packages/plugin-registry/dist/cli.js")
      const script = fs.existsSync(registryScript) ? registryScript : fallbackScript
      runShellCommand(process.execPath, [script, "verify", pkgName])
      return true
    }

    // Sprint 9: marketplace subcommand
    if (subcommand === "marketplace" || subcommand === "publish") {
      const mScript = (() => {
        const p1 = path.resolve(__dirname, "../../../scripts/v45/marketplace.mjs")
        const p2 = path.resolve(process.cwd(), "scripts/v45/marketplace.mjs")
        return fs.existsSync(p1) ? p1 : p2
      })()
      const mCmd = subcommand === "publish" ? "publish" : (pluginArgs[0] ?? "help")
      runShellCommand(process.execPath, [
        mScript,
        mCmd,
        ...pluginArgs.slice(subcommand === "marketplace" ? 1 : 0),
      ])
      return true
    }

    const plugins = loadRegistry()

    if (subcommand === "search") {
      const query = pluginArgs.join(" ").toLowerCase().trim()
      const results = plugins.filter((plugin) => {
        if (!query) return true
        return (
          plugin.name.toLowerCase().includes(query) ||
          plugin.description.toLowerCase().includes(query) ||
          plugin.tags.some((tag) => tag.toLowerCase().includes(query))
        )
      })
      console.table(results)
      return true
    }

    if (subcommand === "list") {
      console.table(plugins)
      return true
    }

    if (subcommand === "install") {
      const pluginName = pluginArgs[0]
      if (!pluginName) {
        console.error("Missing plugin name")
        process.exit(1)
      }
      runShellCommand("npm", ["install", pluginName])
      return true
    }

    console.error("Unknown plugin command")
    process.exit(1)
  }

  if (command === "dashboard") {
    const port = readFlag("port", restArgs) ?? process.env.PORT ?? "3000"
    // Try direct server path first, fall back to npm dev
    const serverScript = path.resolve(__dirname, "../../../packages/dashboard/src/server.mjs")
    const fallback = path.resolve(process.cwd(), "packages/dashboard/src/server.mjs")
    const script = fs.existsSync(serverScript)
      ? serverScript
      : fs.existsSync(fallback)
        ? fallback
        : null

    if (script) {
      console.log(`[tw dashboard] Starting on http://localhost:${port}`)
      const child = spawn(process.execPath, [script], {
        stdio: "inherit",
        env: { ...process.env, PORT: port },
      })
      child.on("exit", (code) => process.exit(code ?? 0))
    } else {
      // Fallback: npm dev
      const child = spawn("npm", ["run", "dev", "-w", "@tailwind-styled/dashboard"], {
        stdio: "inherit",
        env: { ...process.env, PORT: port },
      })
      child.on("exit", (code) => process.exit(code ?? 0))
    }
    return true
  }

  if (command === "test") {
    const watch = restArgs.includes("--watch")
    runShellCommand("npm", watch ? ["run", "test", "--", "--watch"] : ["run", "test"])
    return true
  }

  if (command === "storybook") {
    const variantsRaw = readFlag("variants", restArgs)
    const port = readFlag("port", restArgs) ?? "6006"
    const open = !restArgs.includes("--no-open")

    // Mode 1: --variants='{...}' → enumerate and print (existing behavior, kept for CI/scripting)
    if (variantsRaw) {
      try {
        const matrix = JSON.parse(variantsRaw) as Record<string, Array<string | number | boolean>>
        const rows = enumerateVariantProps(matrix)
        console.log(JSON.stringify(rows, null, 2))
      } catch {
        console.error("[tw storybook] Invalid JSON in --variants flag")
        process.exit(1)
      }
      return true
    }

    // Mode 2: no --variants → launch Storybook dev server
    console.log(`[tw storybook] Starting Storybook on port ${port}...`)
    console.log(
      `[tw storybook] Tip: use --variants='{"size":["sm","lg"]}' to enumerate variant combinations`
    )

    // Try npx storybook (auto-installs if not present)
    const storybookArgs = ["storybook", "dev", "-p", port]
    if (!open) storybookArgs.push("--no-open")

    const child = spawn("npx", storybookArgs, { stdio: "inherit" })
    child.on("error", () => {
      // Fallback: try ./node_modules/.bin/storybook
      const localBin = path.join(process.cwd(), "node_modules", ".bin", "storybook")
      if (fs.existsSync(localBin)) {
        spawn(localBin, ["dev", "-p", port], { stdio: "inherit" }).on("exit", (code) =>
          process.exit(code ?? 0)
        )
      } else {
        console.error(
          "[tw storybook] Storybook not found. Install with: npm install --save-dev @storybook/react"
        )
        process.exit(1)
      }
    })
    child.on("exit", (code) => process.exit(code ?? 0))
    return true
  }

  if (command === "studio") {
    const project = readFlag("project", restArgs) ?? process.cwd()
    const port = readFlag("port", restArgs) ?? "3030"
    const mode = readFlag("mode", restArgs) ?? "web"
    const studioScript = path.resolve(__dirname, "../../../scripts/v45/studio.mjs")
    const fallback = path.resolve(process.cwd(), "scripts/v45/studio.mjs")
    const script = fs.existsSync(studioScript) ? studioScript : fallback
    if (!fs.existsSync(script)) {
      console.error("[tw studio] script not found — run from project root")
      process.exit(1)
    }
    const child = spawn(
      process.execPath,
      [script, `--project=${project}`, `--port=${port}`, `--mode=${mode}`],
      {
        stdio: "inherit",
        env: { ...process.env, PORT: port },
      }
    )
    child.on("exit", (code) => process.exit(code ?? 0))
    return true
  }

  if (command === "registry") {
    const sub = restArgs[0] ?? "serve"
    // publish/install/versions → use tarball-capable registry script
    const isTarball = ["publish", "install", "versions"].includes(sub)
    const scriptName = isTarball ? "registry-tarball.mjs" : "registry.mjs"
    const script = (() => {
      const p1 = path.resolve(__dirname, `../../../scripts/v45/${scriptName}`)
      const p2 = path.resolve(process.cwd(), `scripts/v45/${scriptName}`)
      return fs.existsSync(p1) ? p1 : p2
    })()
    runShellCommand(process.execPath, [script, sub, ...restArgs.slice(1)])
    return true
  }

  if (command === "install") {
    // tw install <package> [--registry=URL] — shorthand for tw registry install
    const script = (() => {
      const p1 = path.resolve(__dirname, "../../../scripts/v45/registry-tarball.mjs")
      const p2 = path.resolve(process.cwd(), "scripts/v45/registry-tarball.mjs")
      return fs.existsSync(p1) ? p1 : p2
    })()
    runShellCommand(process.execPath, [script, "install", ...restArgs])
    return true
  }

  if (command === "deploy") {
    const name = restArgs.find((a) => !a.startsWith("-")) ?? "component"
    const dryRun = restArgs.includes("--dry-run")
    const version = readFlag("version", restArgs) ?? "0.1.0"
    const tag = readFlag("tag", restArgs) ?? "latest"
    const registryUrl = readFlag("registry", restArgs) ?? process.env.TW_REGISTRY_URL ?? null

    // Step 1: Validate package.json exists
    const pkgPath = path.join(process.cwd(), "package.json")
    if (!fs.existsSync(pkgPath)) {
      console.error("[tw deploy] No package.json found in current directory")
      process.exit(1)
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    const componentName = pkg.name ?? name

    // Step 2: Build manifest
    const manifest = {
      name: componentName,
      version: pkg.version ?? version,
      tag,
      description: pkg.description ?? "",
      keywords: pkg.keywords ?? [],
      publishedAt: new Date().toISOString(),
      source: process.cwd(),
      registry: registryUrl ?? "https://registry.tailwind-styled.dev",
    }

    if (dryRun) {
      console.log("[tw deploy] DRY RUN — would publish:")
      console.log(JSON.stringify(manifest, null, 2))
      if (registryUrl) console.log(`\n[tw deploy] Target registry: ${registryUrl}`)
      return true
    }

    // Step 3: Write local manifest
    const cacheDir = path.join(process.cwd(), ".tw-cache")
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, "deploy-manifest.json"), JSON.stringify(manifest, null, 2))

    // Step 4: Remote publish (if registry URL provided)
    if (registryUrl) {
      try {
        const { default: https } = await import("node:https")
        const { default: http } = await import("node:http")
        const url = new URL("/packages", registryUrl)
        const body = JSON.stringify(manifest)
        const token = process.env.TW_REGISTRY_TOKEN

        const result = await new Promise<any>((resolve, reject) => {
          const client = url.protocol === "https:" ? https : http
          const req = client.request(
            url,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
            },
            (res) => {
              let data = ""
              res.on("data", (c: Buffer) => (data += c))
              res.on("end", () => {
                try {
                  resolve({ status: res.statusCode, body: JSON.parse(data) })
                } catch {
                  resolve({ status: res.statusCode, body: data })
                }
              })
            }
          )
          req.on("error", reject)
          req.write(body)
          req.end()
        })

        if (result.status === 201) {
          console.log(`[tw deploy] ✅ Published: ${componentName}@${manifest.version}`)
          console.log(`[tw deploy] Registry: ${registryUrl}/packages/${componentName}`)
          if (result.body?.id) console.log(`[tw deploy] ID: ${result.body.id}`)
        } else {
          console.error(
            `[tw deploy] ❌ Registry returned ${result.status}: ${JSON.stringify(result.body)}`
          )
          process.exit(1)
        }
      } catch (e: any) {
        console.error(`[tw deploy] ❌ Registry unreachable: ${e.message}`)
        console.log(`[tw deploy] Local manifest saved to .tw-cache/deploy-manifest.json`)
        console.log(`[tw deploy] Start a registry with: tw registry serve`)
        process.exit(1)
      }
    } else {
      console.log(`[tw deploy] Published locally: ${componentName}@${manifest.version}`)
      console.log(`[tw deploy] Manifest: .tw-cache/deploy-manifest.json`)
      console.log(`[tw deploy] To publish remotely: tw deploy --registry=http://localhost:4040`)
      console.log(`[tw deploy] Start registry:      tw registry serve`)
    }
    return true
  }

  if (command === "ai") {
    const prompt = restArgs.join(" ").trim()
    if (!prompt) {
      console.error('Usage: tw ai "describe component"')
      process.exit(1)
    }
    runShellCommand(process.execPath, ["scripts/v45/ai.mjs", prompt])
    return true
  }

  if (command === "sync") {
    const syncCmd = restArgs[0]
    if (!syncCmd) {
      console.error("Usage: tw sync <init|pull|push|diff|figma>")
      process.exit(1)
    }
    // Figma subcommand → delegate to figma-sync.mjs
    if (syncCmd === "figma") {
      const figmaAction = restArgs[1]
      if (!figmaAction) {
        console.error(
          "Usage: tw sync figma <pull|push|diff|modes> [--file=KEY1,KEY2] [--mode=dark]"
        )
        process.exit(1)
      }
      // Use figma-multi for multi-file/mode support, fall back to figma-sync for basic ops
      const isMulti = restArgs.some(
        (a) =>
          a.startsWith("--file=") ||
          a.startsWith("--mode=") ||
          a.startsWith("--from=") ||
          figmaAction === "modes"
      )
      const scriptName = isMulti ? "figma-multi.mjs" : "figma-sync.mjs"
      const p1 = path.resolve(__dirname, `../../../scripts/v45/${scriptName}`)
      const p2 = path.resolve(process.cwd(), `scripts/v45/${scriptName}`)
      const script = fs.existsSync(p1) ? p1 : p2
      runShellCommand(process.execPath, [script, figmaAction, ...restArgs.slice(2)])
      return true
    }
    // Regular sync (init/pull/push/diff)
    const syncScript = path.resolve(__dirname, "../../../scripts/v45/sync.mjs")
    const fallback = path.resolve(process.cwd(), "scripts/v45/sync.mjs")
    const script = fs.existsSync(syncScript) ? syncScript : fallback
    runShellCommand(process.execPath, [script, ...restArgs])
    return true
  }

  if (command === "preflight") {
    // Try compiled preflight.js first; fall back to running src/preflight.ts
    // with --experimental-strip-types (Node 22+) or plain node for .js
    const compiledScript = path.resolve(__dirname, "preflight.js")
    const srcScript = path.resolve(__dirname, "preflight.ts")
    const script = fs.existsSync(compiledScript) ? compiledScript : srcScript
    const nodeArgs = script.endsWith(".ts")
      ? ["--experimental-strip-types", script, ...restArgs]
      : [script, ...restArgs]
    const child = spawn(process.execPath, nodeArgs, { stdio: "inherit" })
    child.on("exit", (code) => process.exit(code ?? 0))
    return true
  }

  if (command === "audit") {
    runShellCommand(process.execPath, ["scripts/v45/audit.mjs"])
    return true
  }

  if (command === "share") {
    const name = restArgs.find((a) => !a.startsWith("-")) ?? "component-name"

    // Try to read deploy manifest if it exists
    const manifestPath = path.join(process.cwd(), ".tw-cache", "deploy-manifest.json")
    let manifest: Record<string, any> = { name, version: "0.1.0" }
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      } catch {}
    }

    const sharePayload = {
      name: manifest.name ?? name,
      version: manifest.version ?? "0.1.0",
      description: manifest.description ?? "",
      keywords: manifest.keywords ?? [],
      registry: manifest.registry ?? "https://registry.tailwind-styled.dev",
      installCommand: `npm install ${manifest.name ?? name}`,
      importExample: `import { ${(manifest.name ?? name).replace(/[^a-zA-Z]/g, "")} } from "${manifest.name ?? name}"`,
      channel: "community",
      sharedAt: new Date().toISOString(),
      instructions: [
        "1. Attach README.md with usage examples",
        "2. Add version tag: git tag v" + (manifest.version ?? "0.1.0"),
        "3. Run `tw deploy` to publish to registry",
        "4. Share this payload in community channels",
      ],
    }

    console.log(JSON.stringify(sharePayload, null, 2))
    return true
  }

  if (command === "parse") {
    const file = restArgs[0]
    if (!file) {
      console.error("Usage: tw parse <file>")
      process.exit(1)
    }
    runShellCommand(process.execPath, ["scripts/v46/parse.mjs", file])
    return true
  }

  if (command === "transform") {
    const file = restArgs[0]
    const out = restArgs[1]
    if (!file) {
      console.error("Usage: tw transform <file> [outFile]")
      process.exit(1)
    }
    const args = ["scripts/v46/transform.mjs", file]
    if (out) args.push(out)
    runShellCommand(process.execPath, args)
    return true
  }

  if (command === "minify") {
    const file = restArgs[0]
    if (!file) {
      console.error("Usage: tw minify <file>")
      process.exit(1)
    }
    runShellCommand(process.execPath, ["scripts/v47/minify.mjs", file])
    return true
  }

  if (command === "shake") {
    const file = restArgs[0]
    if (!file) {
      console.error("Usage: tw shake <css-file>")
      process.exit(1)
    }
    runShellCommand(process.execPath, ["scripts/v47/shake-css.mjs", file])
    return true
  }

  if (command === "lint") {
    const dir = restArgs[0] ?? "."
    const workers = restArgs[1] ?? "0"
    runShellCommand(process.execPath, ["scripts/v48/lint-parallel.mjs", dir, workers])
    return true
  }

  if (command === "format") {
    const file = restArgs.find((arg) => !arg.startsWith("-"))
    if (!file) {
      console.error("Usage: tw format <file> [--write]")
      process.exit(1)
    }
    const args = ["scripts/v48/format.mjs", file]
    if (restArgs.includes("--write")) args.push("--write")
    runShellCommand(process.execPath, args)
    return true
  }

  if (command === "lsp") {
    runShellCommand(process.execPath, ["scripts/v48/lsp.mjs", "--stdio"])
    return true
  }

  if (command === "benchmark") {
    runShellCommand(process.execPath, ["scripts/v48/benchmark-toolchains.mjs"])
    return true
  }

  if (command === "optimize") {
    const file = restArgs[0]
    if (!file) {
      console.error("Usage: tw optimize <file> [--constant-folding] [--partial-eval]")
      process.exit(1)
    }
    runShellCommand(process.execPath, ["scripts/v49/optimize.mjs", ...restArgs])
    return true
  }

  if (command === "split") {
    const root = restArgs[0] ?? "."
    const outDir = restArgs[1] ?? "artifacts/route-css"
    runShellCommand(process.execPath, ["scripts/v49/split-routes.mjs", root, outDir])
    return true
  }

  if (command === "critical") {
    const html = restArgs[0]
    const css = restArgs[1]
    if (!html || !css) {
      console.error("Usage: tw critical <html-file> <css-file>")
      process.exit(1)
    }
    runShellCommand(process.execPath, ["scripts/v49/critical-css.mjs", html, css])
    return true
  }

  if (command === "cache") {
    const sub = restArgs[0]
    const extra = restArgs[1]
    const args = ["scripts/v50/cache.mjs"]
    if (sub) args.push(sub)
    if (extra) args.push(extra)
    runShellCommand(process.execPath, args)
    return true
  }

  if (command === "cluster") {
    const sub = restArgs[0]
    const workers = restArgs[1]
    const args = ["scripts/v50/cluster.mjs"]
    if (sub) args.push(sub)
    if (workers) args.push(workers)
    // Pass through --remote and --token flags
    restArgs
      .filter((a) => a.startsWith("--remote=") || a.startsWith("--token="))
      .forEach((a) => args.push(a))
    runShellCommand(process.execPath, args)
    return true
  }

  if (command === "cluster-server") {
    const serverScript = path.resolve(__dirname, "../../../scripts/v50/cluster-server.mjs")
    const fallback = path.resolve(process.cwd(), "scripts/v50/cluster-server.mjs")
    const script = fs.existsSync(serverScript) ? serverScript : fallback
    const child = spawn(process.execPath, [script, ...restArgs], { stdio: "inherit" })
    child.on("exit", (code) => process.exit(code ?? 0))
    return true
  }

  if (command === "adopt") {
    const feature = restArgs[0]
    const project = restArgs[1]
    const args = ["scripts/v50/adopt.mjs"]
    if (feature) args.push(feature)
    if (project) args.push(project)
    runShellCommand(process.execPath, args)
    return true
  }

  if (command === "metrics") {
    const port = restArgs[0] ?? "3030"
    runShellCommand(process.execPath, ["scripts/v50/metrics.mjs", port])
    return true
  }

  if (command === "code") {
    if (restArgs.includes("--docs")) {
      console.log("https://marketplace.visualstudio.com/search?term=tailwind-styled&target=VSCode")
      return true
    }
    if (restArgs.includes("--install")) {
      runShellCommand("code", ["--install-extension", "tailwind-styled.tailwind-styled-v4"])
      return true
    }

    console.log("Use: tw code --docs | tw code --install")
    return true
  }

  return false
}

runUnifiedCommand()
  .then((handled) => {
    if (handled) return

    switch (command) {
      case "setup":
        runSetupCli(restArgs).catch((e) => {
          console.error(e.message)
          process.exit(1)
        })
        break
      case "init":
        runInitCli(restArgs)
        break
      case "scan":
        runScanCli(restArgs)
        break
      case "migrate":
        runMigrateCli(restArgs).catch((err) => {
          console.error("Migration failed:", err)
          process.exit(1)
        })
        break
      case "analyze":
        runAnalyzeCli(restArgs)
        break
      case "stats":
        runStatsCli(restArgs)
        break
      case "extract":
        runExtractCli(restArgs)
        break
      case "help":
      case "--help":
      case "-h":
      case undefined:
        console.log(HELP)
        break
      default:
        console.error(`Unknown command: ${command}`)
        console.log(HELP)
        process.exit(1)
    }
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
