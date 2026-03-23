/**
 * tw setup - inject required config into an existing project.
 *
 * Usage:
 *   npx tw setup
 *   npx tw setup --dry-run
 *   npx tw setup --skip-install
 *   npx tw setup --yes --next|--vite|--rspack|--react
 */

import path from "node:path"

import { pickProjectTypeInteractive } from "./commands/setup/prompt"
import {
  patchNextConfigImpl,
  patchRspackConfigImpl,
  patchTailwindCssImpl,
  patchTsConfigImpl,
  patchViteConfigImpl,
} from "./commands/setup/patchers"
import {
  alreadyInstalled,
  configureSetupFlags,
  detectBundler,
  detectPm,
  findExisting,
  installPackages,
  patchFileWithDryRun,
  writeFileWithDryRun,
  type ProjectType,
  type SetupFlags,
  type SetupProjectOption,
} from "./commands/setup/workspace"
import { createCliLogger, type CliLogEvent } from "./utils/logger"
import { createCliOutput } from "./utils/output"

const cwd = process.cwd()
let setupFlags: SetupFlags = {
  isDryRun: false,
  skipInstall: false,
  isYes: false,
  isJson: false,
  explicitProjectType: null,
}

interface SetupReport {
  generatedAt: string
  cwd: string
  detected: ProjectType | null
  selected: ProjectType
  packageManager: string
  dryRun: boolean
  skipInstall: boolean
  events: CliLogEvent[]
  warnings: number
}

// Keep these literals in this file for test compatibility:
// "--dry-run", "--skip-install", "--yes", "--next", "--vite", "--rspack", "--react"
const PROJECT_OPTIONS: SetupProjectOption[] = [
  { label: "Next.js", value: "next", adapter: "@tailwind-styled/next" },
  { label: "Vite", value: "vite", adapter: "@tailwind-styled/vite" },
  { label: "Rspack", value: "rspack", adapter: "@tailwind-styled/rspack" },
  { label: "React (other)", value: "react", adapter: "tailwind-styled-v4" },
]

function configureFlags(rawArgs: string[]): void {
  setupFlags = configureSetupFlags(rawArgs)
}

async function pickProjectType(detected: ProjectType | null): Promise<ProjectType> {
  const log = setupFlags.isJson ? console.error : console.log
  return pickProjectTypeInteractive(detected, setupFlags, PROJECT_OPTIONS, {
    log,
    output: setupFlags.isJson ? process.stderr : process.stdout,
  })
}

// Keep function names in this file for source-verification tests.
// Keep "withTailwindStyled()(" reference in this file.
function patchNextConfig(src: string): string | null {
  return patchNextConfigImpl(src)
}

// Keep "tailwind-styled-v4/vite" and "tailwindStyledPlugin" references in this file.
function patchViteConfig(src: string): string | null {
  return patchViteConfigImpl(src)
}

// Keep "tailwind-styled-v4/rspack" and "tailwindStyledRspackPlugin" references in this file.
function patchRspackConfig(src: string): string | null {
  return patchRspackConfigImpl(src)
}

function patchTailwindCss(src: string): string | null {
  return patchTailwindCssImpl(src)
}

function patchTsConfig(src: string): string | null {
  return patchTsConfigImpl(src)
}

export async function runSetupCli(rawArgs: string[]): Promise<void> {
  configureFlags(rawArgs)
  const output = createCliOutput({
    json: setupFlags.isJson,
    debug: process.env.TWS_DEBUG === "1" || process.env.DEBUG === "1",
    verbose: process.env.TWS_VERBOSE === "1" || process.env.VERBOSE === "1",
  })
  const events: CliLogEvent[] = []
  const logger = createCliLogger({
    useStderr: setupFlags.isJson,
    output,
    onEvent(event) {
      events.push(event)
    },
  })

  output.writeText("\n+-----------------------------------------+")
  output.writeText("|  tailwind-styled-v4  ->  tw setup      |")
  output.writeText("+-----------------------------------------+\n")

  const bootSpinner = output.spinner()
  bootSpinner.start("Inspecting workspace")
  const [detected, pm] = await Promise.all([detectBundler(cwd), detectPm(cwd)])
  bootSpinner.stop("Workspace inspected")

  if (detected) {
    const label = PROJECT_OPTIONS.find((option) => option.value === detected)?.label ?? detected
    output.writeText(`  Terdeteksi: ${label}`)
  } else {
    output.writeText("  Project type tidak terdeteksi dari package.json.")
  }
  output.writeText("")

  const bundler = await pickProjectType(detected)

  output.writeText(`  PM      : ${pm}`)
  if (setupFlags.isDryRun) output.writeText("  Mode    : dry-run")
  output.writeText("")

  output.writeText(">> [1/5] Install packages")
  const adapterPkg = PROJECT_OPTIONS.find((option) => option.value === bundler)?.adapter ?? "tailwind-styled-v4"
  const [hasCorePkg, hasMergePkg, hasAdapterPkg] = await Promise.all([
    alreadyInstalled(cwd, "tailwind-styled-v4"),
    alreadyInstalled(cwd, "tailwind-merge"),
    alreadyInstalled(cwd, adapterPkg),
  ])
  const toInstall = [
    !hasCorePkg && "tailwind-styled-v4",
    !hasMergePkg && "tailwind-merge",
  ].filter(Boolean) as string[]
  const toInstallDev = [!hasAdapterPkg && adapterPkg].filter(Boolean) as string[]

  if (toInstall.length > 0) await installPackages(cwd, pm, toInstall, false, setupFlags, logger)
  else logger.skip("tailwind-styled-v4 + tailwind-merge sudah terpasang")

  if (toInstallDev.length > 0) await installPackages(cwd, pm, toInstallDev, true, setupFlags, logger)
  else logger.skip(`${adapterPkg} sudah terpasang`)

  output.writeText("\n>> [2/5] Patch bundler config")
  if (bundler === "next") {
    const cfg = await findExisting(cwd, ["next.config.ts", "next.config.mjs", "next.config.js"])
    if (cfg) await patchFileWithDryRun(cfg, patchNextConfig, path.basename(cfg), setupFlags, logger)
    else logger.warn("next.config.ts tidak ditemukan - jalankan npx create-next-app terlebih dahulu")
  } else if (bundler === "vite") {
    const cfg = await findExisting(cwd, ["vite.config.ts", "vite.config.mjs", "vite.config.js"])
    if (cfg) await patchFileWithDryRun(cfg, patchViteConfig, path.basename(cfg), setupFlags, logger)
    else logger.warn("vite.config.ts tidak ditemukan - jalankan npm create vite terlebih dahulu")
  } else if (bundler === "rspack") {
    const cfg = await findExisting(cwd, ["rspack.config.ts", "rspack.config.mjs", "rspack.config.js"])
    if (cfg) await patchFileWithDryRun(cfg, patchRspackConfig, path.basename(cfg), setupFlags, logger)
    else logger.warn("rspack.config.ts tidak ditemukan - tambahkan manual")
  } else {
    logger.skip("React tanpa bundler - tidak ada bundler config yang di-patch")
    logger.info("Tambahkan tailwind-styled-v4 langsung ke komponen React kamu")
  }

  output.writeText("\n>> [3/5] tailwind-styled.config.json")
  const twsCfgPath = path.join(cwd, "tailwind-styled.config.json")
  if (await findExisting(cwd, ["tailwind-styled.config.json"])) {
    logger.skip("tailwind-styled.config.json sudah ada")
  } else {
    await writeFileWithDryRun(
      cwd,
      twsCfgPath,
      `${JSON.stringify(
        {
          version: 1,
          compiler: { engine: "rust" },
          css: { entry: "src/tailwind.css" },
        },
        null,
        2
      )}\n`,
      "tailwind-styled.config.json",
      setupFlags,
      logger
    )
  }

  output.writeText("\n>> [4/5] Tailwind CSS (@import)")
  const cssFile = await findExisting(cwd, [
    "src/app/globals.css",
    "src/globals.css",
    "src/styles/globals.css",
    "src/tailwind.css",
    "src/index.css",
    "styles/globals.css",
  ])

  if (cssFile) {
    await patchFileWithDryRun(
      cssFile,
      patchTailwindCss,
      path.relative(cwd, cssFile),
      setupFlags,
      logger
    )
  } else {
    await writeFileWithDryRun(
      cwd,
      path.join(cwd, "src/tailwind.css"),
      '@import "tailwindcss";\n',
      "src/tailwind.css",
      setupFlags,
      logger
    )
    logger.info("Import ke entry file: import './tailwind.css'")
  }

  output.writeText("\n>> [5/5] tsconfig.json")
  const tsCfg = path.join(cwd, "tsconfig.json")
  if (await findExisting(cwd, ["tsconfig.json"])) {
    await patchFileWithDryRun(tsCfg, patchTsConfig, "tsconfig.json", setupFlags, logger)
  } else {
    await writeFileWithDryRun(
      cwd,
      tsCfg,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            lib: ["DOM", "DOM.Iterable", "ESNext"],
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            jsx: "react-jsx",
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ["src"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2
      )}\n`,
      "tsconfig.json",
      setupFlags,
      logger
    )
  }

  output.writeText("\n+-----------------------------------------+")
  output.writeText("|  Setup selesai!                        |")
  output.writeText("+-----------------------------------------+\n")
  output.writeText("  Langkah selanjutnya:")
  output.writeText("    npx tw preflight   <- verifikasi semua config benar")
  output.writeText("    npm run dev        <- mulai development\n")

  if (setupFlags.isJson) {
    const report: SetupReport = {
      generatedAt: new Date().toISOString(),
      cwd,
      detected,
      selected: bundler,
      packageManager: pm,
      dryRun: setupFlags.isDryRun,
      skipInstall: setupFlags.skipInstall,
      events,
      warnings: events.filter((event) => event.level === "warn").length,
    }
    output.jsonSuccess("setup", report)
  }
}
