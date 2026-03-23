/**
 * tailwind-styled-v4 — Component Hoister
 *
 * Problem: Component yang didefinisikan di dalam fungsi lain
 * akan direcreate setiap render — sangat buruk untuk performa.
 *
 * BEFORE (buruk):
 *   export default function Page() {
 *     const Box = tw.div`p-4`   ← dibuat ulang tiap render!
 *     return <Box/>
 *   }
 *
 * AFTER (benar):
 *   const Box = tw.div`p-4`    ← module scope, dibuat sekali
 *   export default function Page() {
 *     return <Box/>
 *   }
 *
 * Hoister mendeteksi pola ini dan memindahkan deklarasi ke module scope.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────────────────────────────────────

// Match: const Name = tw.tag`...` atau const Name = tw.tag({...})
// yang ada di dalam function body (indent > 0)
const INDENTED_TW_DECL_RE = /^([ \t]+)(const|let)\s+([A-Z]\w*)\s*=\s*tw\.[\w]+[`(]/gm

// ─────────────────────────────────────────────────────────────────────────────
// Hoist analysis
// ─────────────────────────────────────────────────────────────────────────────

export interface HoistResult {
  code: string
  hoisted: string[]
  warnings: string[]
}

export function hoistComponents(source: string): HoistResult {
  const hoisted: string[] = []
  const warnings: string[] = []

  // Cari semua tw declarations yang indented (di dalam function body)
  const indentedDecls: Array<{
    fullMatch: string
    indent: string
    keyword: string
    name: string
    startIndex: number
  }> = []

  let m: RegExpExecArray | null
  const re = new RegExp(INDENTED_TW_DECL_RE.source, "gm")

  while ((m = re.exec(source)) !== null) {
    const indent = m[1]
    const keyword = m[2]
    const name = m[3]

    // Hanya hoist components (PascalCase), bukan variables biasa
    if (!/^[A-Z]/.test(name)) continue
    // Hanya hoist jika di dalam function (indent > 0)
    if (indent.length === 0) continue

    indentedDecls.push({
      fullMatch: m[0],
      indent,
      keyword,
      name,
      startIndex: m.index,
    })
  }

  if (indentedDecls.length === 0) {
    return { code: source, hoisted: [], warnings: [] }
  }

  // Untuk setiap indented declaration, extract full statement
  // dan pindahkan ke top of file
  let code = source
  const hoistedDecls: string[] = []

  // Process in reverse order to maintain correct indices
  for (const decl of [...indentedDecls].reverse()) {
    const { startIndex, indent, name } = decl

    // Cari end of the tw statement (sampai semicolon atau newline setelah `)`)
    const lineStart = code.lastIndexOf("\n", startIndex) + 1
    const restFromDecl = code.slice(lineStart)

    // Extract full statement — bisa multi-line untuk template literals
    const fullStmt = extractFullStatement(restFromDecl)
    if (!fullStmt) continue

    // Dedent statement
    const dedented = fullStmt
      .split("\n")
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join("\n")
      .trim()

    // Remove from original position
    code = code.slice(0, lineStart) + code.slice(lineStart + fullStmt.length)

    // Collect for hoisting
    hoistedDecls.unshift(dedented)
    hoisted.push(name)

    warnings.push(
      `[tw-hoist] '${name}' moved to module scope for better performance. ` +
        `Avoid defining tw components inside render functions.`
    )
  }

  // Inject hoisted declarations after imports
  if (hoistedDecls.length > 0) {
    const insertPoint = findAfterImports(code)
    const hoistBlock = `\n${hoistedDecls.join("\n\n")}\n`
    code = code.slice(0, insertPoint) + hoistBlock + code.slice(insertPoint)
  }

  return { code, hoisted, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractFullStatement(source: string): string | null {
  // Match tw template literal statement
  const templateRe = /^[ \t]*(const|let)\s+\w+\s*=\s*tw\.\w+`[^`]*`.*\n?/
  const templateMatch = source.match(templateRe)
  if (templateMatch) return templateMatch[0]

  // Match tw object config statement — may span multiple lines
  // Find balancing braces
  const objStart = source.indexOf("tw.")
  if (objStart === -1) return null

  const parenStart = source.indexOf("(", objStart)
  if (parenStart === -1) return null

  let depth = 0
  let i = parenStart

  while (i < source.length) {
    if (source[i] === "(") depth++
    if (source[i] === ")") {
      depth--
      if (depth === 0) {
        // Include trailing semicolon and newline
        const end = source.indexOf("\n", i)
        return source.slice(0, end === -1 ? i + 1 : end + 1)
      }
    }
    i++
  }

  return null
}

function findAfterImports(source: string): number {
  const lines = source.split("\n")
  let lastImportLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (
      line.startsWith("import ") ||
      line.startsWith("'use client'") ||
      line.startsWith('"use client"')
    ) {
      lastImportLine = i
    } else if (line && !line.startsWith("//") && !line.startsWith("/*") && lastImportLine > 0) {
      // First non-import, non-comment line after imports
      break
    }
  }

  // Return character index after last import line
  return lines.slice(0, lastImportLine + 1).join("\n").length + 1
}
