export function patchNextConfigImpl(src: string): string | null {
  if (src.includes("withTailwindStyled")) return null
  const hasExport = src.includes("export default")
  const hasCjs = src.includes("module.exports")

  if (hasExport) {
    const withImport = `import { withTailwindStyled } from "@tailwind-styled/next"\n${src}`
    return withImport
      .replace(
        /export default\s+([\w]+);?\s*$/m,
        (_match, expr) => `export default withTailwindStyled()(${expr})`
      )
      .replace(
        /export default\s+(defineConfig\([\s\S]*?\));?\s*$/m,
        (_match, expr) => `export default withTailwindStyled()(${expr})`
      )
      .replace(
        /export default\s+(\{[\s\S]*?\});?\s*$/m,
        (_match, expr) => `export default withTailwindStyled()(${expr})`
      )
  }

  if (hasCjs) {
    return (
      `const { withTailwindStyled } = require("@tailwind-styled/next")\n` +
      src.replace(
        /module\.exports\s*=\s*(.+)/s,
        (_match, expr) => `module.exports = withTailwindStyled()(${expr.trim()})`
      )
    )
  }

  return null
}

export function patchViteConfigImpl(src: string): string | null {
  const hasLegacyImport = src.includes("tailwind-styled-v4/vite")
  let patched = src

  if (hasLegacyImport) {
    patched = patched.replace(
      /from\s+['"]tailwind-styled-v4\/vite['"]/g,
      'from "@tailwind-styled/vite"'
    )
  }

  patched = patched.replace(/\btailwindStyled\(/g, "tailwindStyledPlugin(")

  const alreadyConfigured =
    patched.includes("@tailwind-styled/vite") && patched.includes("tailwindStyledPlugin(")
  if (alreadyConfigured) return patched === src ? null : patched

  const viteImportMatch = patched.match(/(import .+ from ['"]vite['"][^\n]*\n)/)
  const reactImportMatch = patched.match(/(import .+ from ['"]@vitejs\/plugin-react['"][^\n]*\n)/)
  const insertAfter = (reactImportMatch ?? viteImportMatch)?.[1]

  if (!patched.includes("@tailwind-styled/vite") && insertAfter) {
    patched = patched.replace(
      insertAfter,
      `${insertAfter}import { tailwindStyledPlugin } from "@tailwind-styled/vite"\n`
    )
  } else if (!patched.includes("@tailwind-styled/vite")) {
    patched = `import { tailwindStyledPlugin } from "@tailwind-styled/vite"\n${patched}`
  }

  if (!patched.includes("tailwindStyledPlugin(")) {
    const withPluginArray = patched.replace(
      /plugins:\s*\[([^\]]*)\]/s,
      (_match, inner) => `plugins: [${inner.trimEnd()}\n    tailwindStyledPlugin(),\n  ]`
    )
    if (withPluginArray !== patched) {
      patched = withPluginArray
    } else {
      patched = patched.replace(
        /(export default defineConfig\(\{[\s\S]*?)(\}\))/,
        (_match, body, close) => `${body}  plugins: [tailwindStyledPlugin()],\n${close}`
      )
    }
  }

  return patched === src ? null : patched
}

export function patchRspackConfigImpl(src: string): string | null {
  const hasModernImport = src.includes("@tailwind-styled/rspack")
  const hasLegacyImport = src.includes("tailwind-styled-v4/rspack")
  let patched = src

  if (hasLegacyImport) {
    patched = patched.replace(
      /from\s+['"]tailwind-styled-v4\/rspack['"]/g,
      'from "@tailwind-styled/rspack"'
    )
  }

  patched = patched.replace(/\btailwindStyled\(/g, "tailwindStyledRspackPlugin(")

  const alreadyConfigured =
    patched.includes("@tailwind-styled/rspack") &&
    patched.includes("tailwindStyledRspackPlugin(")
  if (alreadyConfigured) return patched === src ? null : patched

  if (!patched.includes("@tailwind-styled/rspack") && !hasModernImport) {
    const lines = patched.split("\n")
    let lastImportIdx = 0
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith("import ")) lastImportIdx = index
    })
    lines.splice(
      lastImportIdx + 1,
      0,
      'import { tailwindStyledRspackPlugin } from "@tailwind-styled/rspack"'
    )
    patched = lines.join("\n")
  }

  if (!patched.includes("tailwindStyledRspackPlugin(")) {
    if (patched.includes("plugins:")) {
      patched = patched.replace(
        /plugins:\s*\[([^\]]*)\]/s,
        (_match, inner) =>
          `plugins: [${inner.trimEnd()}\n    tailwindStyledRspackPlugin(),\n  ]`
      )
    } else {
      patched = patched.replace(
        /(export default defineConfig\(\{[\s\S]*?)(\}\))/,
        (_match, body, close) => `${body}  plugins: [tailwindStyledRspackPlugin()],\n${close}`
      )
    }
  }

  return patched === src ? null : patched
}

export function patchTailwindCssImpl(src: string): string | null {
  if (src.includes('@import "tailwindcss"') || src.includes("@import 'tailwindcss'")) return null
  return `@import "tailwindcss";\n\n${src}`
}

export function patchTsConfigImpl(src: string): string | null {
  try {
    const json = JSON.parse(src) as { compilerOptions?: Record<string, unknown> }
    const compilerOptions = (json.compilerOptions ?? {}) as Record<string, unknown>
    let changed = false

    if (!compilerOptions.paths) {
      compilerOptions.paths = {}
      changed = true
    }
    if (compilerOptions.strict === undefined) {
      compilerOptions.strict = true
      changed = true
    }
    if (
      compilerOptions.moduleResolution !== "bundler" &&
      compilerOptions.moduleResolution !== "node16"
    ) {
      compilerOptions.moduleResolution = "bundler"
      changed = true
    }
    if (!compilerOptions.jsx) {
      compilerOptions.jsx = "react-jsx"
      changed = true
    }

    if (!changed) return null
    json.compilerOptions = compilerOptions
    return `${JSON.stringify(json, null, 2)}\n`
  } catch {
    return null
  }
}
