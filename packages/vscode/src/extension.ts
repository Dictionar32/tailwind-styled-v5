import * as path from "node:path"
import { type AnalyzerReport, analyzeWorkspace } from "@tailwind-styled/analyzer"
import * as cp from "child_process"
import * as fs from "fs"
import * as vscode from "vscode"
import { SCRIPT_VERSION, SCRIPTS } from "./constants"
import { reportHealth, runHealthCheck } from "./health-check"
import { execScript, killAllProcesses } from "./utils/exec-script"
import { findLspScript, findScript } from "./utils/resolve-script"

let outputChannel: vscode.OutputChannel | undefined
let lspProcess: cp.ChildProcess | null = null

function getWorkspaceRoot(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder?.uri.fsPath ?? null
}

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Tailwind Styled")
  }
  return outputChannel
}

function toSummary(report: AnalyzerReport): string {
  const topClasses = report.classStats.top
    .slice(0, 3)
    .map((item) => `${item.name} (${item.count})`)
    .join(", ")

  return [
    `Files: ${report.totalFiles}`,
    `Unique classes: ${report.uniqueClassCount}`,
    `Occurrences: ${report.totalClassOccurrences}`,
    topClasses.length > 0 ? `Top: ${topClasses}` : "Top: -",
  ].join(" • ")
}

// ─── Analyze workspace ───────────────────────────────────────────────────────-

async function analyzeWorkspaceCommand(): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage("Tailwind Styled: open a workspace folder first.")
    return
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Tailwind Styled: analyzing workspace",
        cancellable: false,
      },
      async () => {
        const report = await analyzeWorkspace(root, {
          classStats: { top: 10, frequentThreshold: 2 },
        })
        const message = toSummary(report)
        vscode.window.showInformationMessage(message)

        const output = getOutputChannel()
        output.clear()
        output.appendLine(`Workspace: ${path.basename(root)}`)
        output.appendLine(`[v${SCRIPT_VERSION}] Analysis complete`)
        output.appendLine(JSON.stringify(report, null, 2))
        output.show(true)
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    vscode.window.showErrorMessage(`Tailwind Styled: analysis failed — ${message}`)
  }
}

// ─── Install plugin ───────────────────────────────────────────────────────────

async function installPluginCommand(): Promise<void> {
  const pluginName = await vscode.window.showInputBox({
    prompt: "Plugin package name",
    placeHolder: "@tailwind-styled/plugin-animation",
  })

  if (!pluginName) return

  const root = getWorkspaceRoot()
  const output = getOutputChannel()
  output.show(true)
  output.appendLine(`[plugin] installing: ${pluginName}`)

  if (root) {
    const { exec } = require("node:child_process")
    exec(
      `npm install ${pluginName}`,
      { cwd: root },
      (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          output.appendLine(`[plugin] ERROR: ${stderr || err.message}`)
          vscode.window.showErrorMessage(`Tailwind Styled: install failed — ${err.message}`)
        } else {
          output.appendLine(stdout)
          vscode.window.showInformationMessage(`Tailwind Styled: installed ${pluginName}`)
        }
      }
    )
  } else {
    vscode.window.showWarningMessage("Tailwind Styled: open a workspace folder to install plugins.")
  }
}

// ─── Create component (with AI) ───────────────────────────────────────────────

async function createComponentCommand(): Promise<void> {
  const componentName = await vscode.window.showInputBox({
    prompt: "Component name",
    placeHolder: "Button",
    validateInput: (value) =>
      value.trim().length === 0 ? "Component name is required" : undefined,
  })

  if (!componentName) return

  const useAi = await vscode.window.showQuickPick(
    [
      {
        label: "$(sparkle) AI-generated",
        description: "Generate using AI (requires ANTHROPIC_API_KEY)",
        value: "ai",
      },
      { label: "$(file-code) Snippet", description: "Insert basic tw() snippet", value: "snippet" },
    ],
    { placeHolder: "How to create the component?" }
  )

  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage("Tailwind Styled: open a file to insert component.")
    return
  }

  if (useAi?.value === "ai") {
    const root = getWorkspaceRoot()
    if (!root) {
      vscode.window.showWarningMessage("Tailwind Styled: open a workspace to use AI generation.")
      return
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Generating ${componentName}...` },
      async () => {
        const aiScript = findScript(root, SCRIPTS.ai)
        if (!aiScript) {
          vscode.window.showErrorMessage(
            `Tailwind Styled: AI script not found. Please ensure scripts are installed.`
          )
          getOutputChannel().appendLine(`[error] AI script not found. Tried: ${SCRIPTS.ai}`)
          return
        }

        const provider = getConfig("ai.provider", "anthropic")
        const result = await execScript(aiScript, [componentName, `--provider=${provider}`], {
          cwd: root,
        })

        if (result.code === 0 && result.stdout.trim()) {
          const snippet = new vscode.SnippetString(result.stdout.trim() + "\n")
          await editor.insertSnippet(snippet)
          vscode.window.showInformationMessage(
            `Tailwind Styled: inserted ${componentName} (AI-generated)`
          )
        } else {
          vscode.window.showWarningMessage(
            `Tailwind Styled: AI generation failed, using snippet fallback`
          )
          if (result.stderr) {
            getOutputChannel().appendLine(`[ai] Error: ${result.stderr}`)
          }
          insertBasicSnippet(editor, componentName)
        }
      }
    )
  } else {
    insertBasicSnippet(editor, componentName)
  }
}

function insertBasicSnippet(editor: vscode.TextEditor, name: string): void {
  const snippet = new vscode.SnippetString(
    `const ${name} = tw.\${1|button,div,span,a|input|}({\n` +
      `  base: "\${2:px-4 py-2 rounded-md}",\n` +
      `  variants: {\n` +
      `    intent: {\n` +
      `      primary: "\${3:bg-blue-500 text-white}",\n` +
      `      ghost: "\${4:bg-transparent border}",\n` +
      `    },\n` +
      `  },\n` +
      `  defaultVariants: { intent: "primary" },\n` +
      `})\n\nexport default ${name}\n`
  )
  editor.insertSnippet(snippet)
  vscode.window.showInformationMessage(`Tailwind Styled: inserted ${name} snippet.`)
}

// ─── Route CSS split ──────────────────────────────────────────────────────────

async function splitRoutesCssCommand(): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage("Tailwind Styled: open a workspace folder first.")
    return
  }

  const outDir = path.join(root, "artifacts", "route-css")

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Tailwind Styled: splitting CSS per route...",
    },
    async () => {
      const splitScript = findScript(root, SCRIPTS.splitRoutes)
      if (!splitScript) {
        vscode.window.showErrorMessage(
          `Tailwind Styled: split-routes script not found. Please ensure scripts are installed.`
        )
        getOutputChannel().appendLine(
          `[error] split-routes script not found. Tried: ${SCRIPTS.splitRoutes}`
        )
        return
      }

      const result = await execScript(splitScript, [root, outDir], { cwd: root })
      const output = getOutputChannel()
      output.show(true)

      if (result.code === 0) {
        let stats: Record<string, unknown> = {}
        try {
          stats = JSON.parse(result.stdout)
        } catch {}
        output.appendLine(
          `[split-routes] ${stats.routesGenerated ?? "?"} routes, ${stats.totalClasses ?? "?"} classes`
        )
        output.appendLine(`[split-routes] Output: ${outDir}`)
        if (stats.manifest) {
          for (const [route, file] of Object.entries(stats.manifest)) {
            output.appendLine(`  ${route} → ${file}`)
          }
        }
        vscode.window.showInformationMessage(
          `Tailwind Styled: ${stats.routesGenerated ?? "?"} route CSS files generated`
        )
      } else {
        output.appendLine(`[split-routes] Error: ${result.stderr}`)
        vscode.window.showErrorMessage(
          "Tailwind Styled: route CSS split failed — see output channel"
        )
      }
    }
  )
}

// ─── Figma sync ───────────────────────────────────────────────────────────────

async function figmaSyncCommand(): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage("Tailwind Styled: open a workspace folder first.")
    return
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: "$(cloud-download) Pull from Figma", value: "pull" },
      { label: "$(cloud-upload) Push to Figma", value: "push" },
      { label: "$(diff) Diff with Figma", value: "diff" },
    ],
    { placeHolder: "Figma token sync action" }
  )

  if (!action) return

  const output = getOutputChannel()
  output.show(true)
  output.appendLine(`[figma-sync] ${action.value}...`)

  const figmaScript = findScript(root, SCRIPTS.figmaSync)
  if (!figmaScript) {
    vscode.window.showErrorMessage(
      `Tailwind Styled: figma-sync script not found. Please ensure scripts are installed.`
    )
    output.appendLine(`[error] figma-sync script not found. Tried: ${SCRIPTS.figmaSync}`)
    return
  }

  const result = await execScript(figmaScript, [action.value], { cwd: root })
  output.appendLine(result.stdout || result.stderr)

  if (result.code === 0) {
    vscode.window.showInformationMessage(`Tailwind Styled: Figma ${action.value} complete`)
  } else if (result.stderr.includes("FIGMA_TOKEN")) {
    vscode.window.showErrorMessage(
      "Tailwind Styled: FIGMA_TOKEN not set. Add it to your environment."
    )
  } else {
    vscode.window.showErrorMessage(
      `Tailwind Styled: Figma ${action.value} failed — see output channel`
    )
  }
}

// ─── LSP Client ───────────────────────────────────────────────────────────────-

function startLspServer(root: string): void {
  if (lspProcess) return
  const lspEnabled = getConfig("lsp.enable", true)
  if (!lspEnabled) {
    console.log("[tailwind-styled] LSP disabled via settings")
    return
  }

  const bundledLspPath = path.join(__dirname, "lsp.mjs")
  const lspScript = findLspScript(root, bundledLspPath)

  if (!lspScript) {
    console.warn("[tailwind-styled] LSP script not found")
    getOutputChannel().appendLine(
      "[LSP] Script not found - install tailwind-styled-v5 or run from monorepo"
    )
    return
  }

  lspProcess = cp.spawn(process.execPath, [lspScript], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TWS_LOG_LEVEL: "warn" },
  })

  lspProcess.on("error", (e) => {
    console.warn("[tailwind-styled] LSP error:", e.message)
    getOutputChannel().appendLine(`[LSP] Error: ${e.message}`)
  })
  lspProcess.on("exit", (code) => {
    console.log(`[tailwind-styled] LSP exited (${code})`)
    lspProcess = null
  })

  console.log("[tailwind-styled] LSP server started:", lspScript)
  getOutputChannel().appendLine(`[LSP] Started: ${lspScript}`)
}

function stopLspServer(): void {
  if (!lspProcess) return
  lspProcess.kill()
  lspProcess = null
  console.log("[tailwind-styled] LSP server stopped")
}

// ─── Extension activate ───────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const output = getOutputChannel()
  output.appendLine(`[Extension] v${SCRIPT_VERSION} activating...`)

  const commands = [
    vscode.commands.registerCommand("tailwindStyled.analyzeWorkspace", analyzeWorkspaceCommand),
    vscode.commands.registerCommand("tailwindStyled.installPlugin", installPluginCommand),
    vscode.commands.registerCommand("tailwindStyled.createComponent", createComponentCommand),
    vscode.commands.registerCommand("tailwindStyled.splitRoutesCss", splitRoutesCssCommand),
    vscode.commands.registerCommand("tailwindStyled.figmaSync", figmaSyncCommand),
  ]

  for (const command of commands) {
    context.subscriptions.push(command)
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (folder) {
    const bundledLspPath = path.join(__dirname, "lsp.mjs")
    const health = runHealthCheck(folder, bundledLspPath)
    reportHealth(health, output)

    if (health.lspPath) {
      startLspServer(folder)
    }

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("tailwindStyled.lsp")) {
          stopLspServer()
          if (folder && getConfig("lsp.enable", true)) startLspServer(folder)
        }
      })
    )
  }

  context.subscriptions.push({ dispose: () => outputChannel?.dispose() })
  output.appendLine(`[Extension] v${SCRIPT_VERSION} activated`)
}

export function deactivate(): void {
  stopLspServer()
  killAllProcesses()
  outputChannel?.dispose()
  outputChannel = undefined
}

function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration("tailwindStyled").get<T>(key, defaultValue)
}
