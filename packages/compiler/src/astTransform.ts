/**
 * tailwind-styled-v4 v2 — AST Transform (RSC-Aware)
 *
 * FIXES:
 *  #01 — Double-merge base in variant component className array
 *  #08 — Idempotency guard — skip if already transformed
 *
 * Pipeline:
 *   source code
 *     ↓ idempotency check (new)
 *     ↓ analyze RSC context
 *     ↓ hoist components (if needed)
 *     ↓ detect tw.server.* vs tw.*
 *     ↓ extract + merge classes
 *     ↓ compile variants → lookup table (variant-only, no base dupe)
 *     ↓ generate React.forwardRef component
 *     ↓ auto "use client" if interactive
 *     ↓ strip tw import
 *     ↓ inject transform marker
 */

// Local type alias for component config (previously imported from @tailwind-styled/plugin)
export interface ComponentConfig {
  base: string
  variants: Record<string, Record<string, string>>
  compoundVariants: Array<{ class: string; [key: string]: any }>
  defaultVariants: Record<string, string>
}

import { getGlobalRegistry } from "@tailwind-styled/plugin"
import { normalizeClasses } from "./classMerger"
import { hoistComponents } from "./componentHoister"
import { analyzeFile, injectClientDirective } from "./rscAnalyzer"
import { hasTwUsage, isAlreadyTransformed, isDynamic, TRANSFORM_MARKER } from "./twDetector"
import { compileVariants, generateVariantCode, parseObjectConfig } from "./variantCompiler"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TransformOptions {
  /** @deprecated Mode is always "zero-runtime" in v5. This option will be removed in v6. */
  mode?: "zero-runtime"
  autoClientBoundary?: boolean
  addDataAttr?: boolean
  hoist?: boolean
  filename?: string
  /** Keep all imports from tailwind-styled-v4 intact — only transform tw.* usages */
  preserveImports?: boolean
  /** Enable Dead Style Elimination - removes unused CSS after transformation (default: false) */
  deadStyleElimination?: boolean
}

export interface TransformResult {
  code: string
  classes: string[]
  rsc?: {
    isServer: boolean
    needsClientDirective: boolean
    clientReasons: string[]
  }
  changed: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns — updated to include server. group
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_RE = /\btw\.(server\.)?(\w+)`((?:[^`\\]|\\.)*)`/g
const OBJECT_RE = /\btw\.(server\.)?(\w+)\(\s*(\{[\s\S]*?\})\s*\)/g
const EXTEND_RE = /(\w+)\.extend`((?:[^`\\]|\\.)*)`/g
const WRAP_RE = /\btw\((\w+)\)`((?:[^`\\]|\\.)*)`/g

let _idCounter = 0
function genId(): string {
  return `c${(++_idCounter).toString(36)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Static component output
// ─────────────────────────────────────────────────────────────────────────────

function renderStaticComponent(
  tag: string,
  classes: string,
  opts: { addDataAttr: boolean; isServer: boolean; compName?: string }
): string {
  const { addDataAttr, compName } = opts
  const fnName = compName ? `_Tw_${compName}` : `_Tw_${tag}`
  const dataAttr = addDataAttr
    ? `, "data-tw": "${fnName}:${classes.split(" ").slice(0, 3).join(" ")}${classes.split(" ").length > 3 ? "..." : ""}"`
    : ""

  return `React.forwardRef(function ${fnName}(props, ref) {
  var _c = props.className;
  var _r = Object.assign({}, props);
  delete _r.className;
  return React.createElement("${tag}", Object.assign({ ref }, _r${dataAttr}, { className: [${JSON.stringify(classes)}, _c].filter(Boolean).join(" ") }));
})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant component output
//
// FIX #01: base is injected here in className array.
//          lookup table contains ONLY variant-specific classes (not base).
//          Previously: compileVariants pre-merged base into table → double base.
// ─────────────────────────────────────────────────────────────────────────────

function renderVariantComponent(
  tag: string,
  id: string,
  base: string,
  variantKeys: string[],
  defaults: Record<string, string>,
  opts: { addDataAttr: boolean; isServer: boolean }
): string {
  const { addDataAttr } = opts
  const fnName = `_TwV_${tag}_${id}`
  const dataAttr = addDataAttr ? `, "data-tw": "${fnName}"` : ""

  // Destructure variant props to prevent leaking to DOM
  const vKeys = variantKeys.map((k) => `"${k}"`).join(", ")
  const destructure =
    variantKeys.length > 0
      ? `var _vp = {}; [${vKeys}].forEach(function(k){ _vp[k] = props[k]; delete _rest[k]; });`
      : ""

  // FIX #01: table values are variant-only (no base pre-merged).
  // base is injected separately as first element — correct, no duplication.
  const variantLookup =
    variantKeys.length > 0
      ? variantKeys
          .map(
            (k) =>
              `(__vt_${id}["${k}"] && __vt_${id}["${k}"][_vp["${k}"] ?? ${JSON.stringify(defaults[k] ?? "")}] || "")`
          )
          .join(", ")
      : ""

  // FIX #01: [base, ...variantClasses, className] — base appears exactly once
  const classParts =
    variantKeys.length > 0
      ? `[${JSON.stringify(base)}, ${variantLookup}, _rest.className]`
      : `[${JSON.stringify(base)}, _rest.className]`

  return `React.forwardRef(function ${fnName}(props, ref) {
  var _rest = Object.assign({}, props);
  delete _rest.className;
  ${destructure}
  return React.createElement("${tag}", Object.assign({ ref }, _rest${dataAttr}, { className: ${classParts}.filter(Boolean).join(" ") }));
})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponent block parser (JS fallback — Rust does this when .node is loaded)
//
// Parses:  tw.button`bg-blue-500\n  icon { mr-2 w-5 h-5 }\n  text { font-medium }`
// Returns: { baseContent, subComponents }
// ─────────────────────────────────────────────────────────────────────────────

const SUB_BLOCK_RE = /\b([a-z][a-zA-Z0-9_]*)\s*\{([^}]*)\}/g

interface SubComponentBlock {
  name: string
  tag: string
  classes: string
  scopedClass: string
}

function shortHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(h, 33) + input.charCodeAt(i)) >>> 0
  }
  return (h & 0xffffff).toString(16).padStart(6, "0")
}

function parseSubcomponentBlocks(
  template: string,
  componentName: string
): { baseContent: string; subComponents: SubComponentBlock[] } {
  const subComponents: SubComponentBlock[] = []
  let stripped = template

  SUB_BLOCK_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = SUB_BLOCK_RE.exec(template)) !== null) {
    const [fullMatch, subName, subClassesRaw] = match
    const subClasses = subClassesRaw.trim()
    if (!subClasses) continue

    const subTag: string = (() => {
      switch (subName) {
        case "label":
          return "label"
        case "input":
          return "input"
        case "img":
        case "image":
          return "img"
        case "header":
          return "header"
        case "footer":
          return "footer"
        default:
          return "span"
      }
    })()

    const hash = shortHash(`${componentName}_${subName}_${subClasses}`)
    const scopedClass = `${componentName}_${subName}_${hash}`

    subComponents.push({ name: subName, tag: subTag, classes: subClasses, scopedClass })
    stripped = stripped.replace(fullMatch, "")
  }

  return { baseContent: stripped.trim(), subComponents }
}

function renderCompoundComponent(
  tag: string,
  baseClasses: string,
  componentName: string,
  subComponents: SubComponentBlock[],
  opts: { addDataAttr: boolean }
): string {
  const fnName = `_Tw_${componentName}`
  const dataAttr = opts.addDataAttr ? `, "data-tw": "${fnName}"` : ""

  const baseBody = `React.forwardRef(function ${fnName}(props, ref) {
  var _c = props.className;
  var _r = Object.assign({}, props);
  delete _r.className;
  return React.createElement("${tag}", Object.assign({ ref }, _r${dataAttr}, { className: [${JSON.stringify(baseClasses)}, _c].filter(Boolean).join(" ") }));
})`

  if (subComponents.length === 0) return baseBody

  const subAssignments = subComponents
    .map((sub) => {
      const subFn = `_Tw_${componentName}_${sub.name}`
      return `  _base.${sub.name} = React.forwardRef(function ${subFn}(props, ref) {
    var _c = props.className;
    var _r = Object.assign({}, props);
    delete _r.className;
    return React.createElement("${sub.tag}", Object.assign({ ref }, _r, { className: [${JSON.stringify(sub.scopedClass)}, _c].filter(Boolean).join(" ") }));
  });`
    })
    .join("\n")

  return `(function() {
  var _base = ${baseBody};
${subAssignments}
  return _base;
})()`
}

// ─────────────────────────────────────────────────────────────────────────────
// Main transform — RSC-Aware pipeline
// ─────────────────────────────────────────────────────────────────────────────

export function transformSource(source: string, opts: TransformOptions = {}): TransformResult {
  const {
    mode = "zero-runtime", // v5: always zero-runtime, parameter kept for backward compat
    autoClientBoundary = true,
    addDataAttr = false,
    hoist = true,
    filename = "",
    preserveImports = false,
  } = opts

  // ── Fast exits ────────────────────────────────────────────────────────
  if (!hasTwUsage(source)) {
    return { code: source, classes: [], changed: false }
  }

  // FIX #08: Idempotency guard — do not transform already-transformed code
  if (isAlreadyTransformed(source)) {
    return { code: source, classes: [], changed: false }
  }

  // v5: Only zero-runtime is supported. The mode parameter is deprecated.
  // This check kept for backward compatibility with v4.
  if (mode && mode !== "zero-runtime") {
    console.warn(
      "[tailwind-styled] Warning: mode option is deprecated in v5. Only zero-runtime is supported."
    )
  }

  // ── STEP 1: RSC Analysis ───────────────────────────────────────────────
  const rscAnalysis = analyzeFile(source, filename)

  // ── STEP 2: Component Hoisting ─────────────────────────────────────────
  let code = source
  if (hoist) {
    const hoistResult = hoistComponents(source)
    if (hoistResult.hoisted.length > 0) {
      code = hoistResult.code
      if (process.env.NODE_ENV !== "production") {
        for (const w of hoistResult.warnings) {
          console.warn(w)
        }
      }
    }
  }

  let changed = false
  const allClasses: string[] = []
  const prelude: string[] = []
  let needsReact = false

  // ── STEP 3a: tw.tag`classes` → static forwardRef (+ compound if blocks present)
  {
    // We need access to the full code string to extract component names,
    // so collect replacements first then apply.
    const snap = code
    const replacements: Array<{ match: string; replacement: string }> = []

    // Pre-build a map of match-start-index → variable name from assignments like:
    //   const Button = tw.button`...`
    const ASSIGN_RE = /(?:const|let|var)\s+(\w+)\s*=\s*tw\.(?:server\.)?(\w+)`/g
    const assignMap = new Map<number, string>() // tw-expr start → varName
    let am: RegExpExecArray | null
    while ((am = ASSIGN_RE.exec(snap)) !== null) {
      // Position of the tw. expression (after `= `)
      const twPos = am.index + am[0].indexOf("tw.")
      assignMap.set(twPos, am[1])
    }

    TEMPLATE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TEMPLATE_RE.exec(snap)) !== null) {
      const [fullMatch, serverMark, tag, content] = m
      if (isDynamic(content)) continue

      const isServerOnly = !!serverMark

      // Resolve component name from assignment context
      const compName = assignMap.get(m.index) ?? null

      // Parse subcomponent blocks out of content
      const { baseContent, subComponents } = compName
        ? parseSubcomponentBlocks(content, compName)
        : { baseContent: content, subComponents: [] }

      const classes = normalizeClasses(baseContent)
      if (!classes && subComponents.length === 0) continue

      allClasses.push(...(classes ?? "").split(/\s+/).filter(Boolean))
      for (const sub of subComponents) {
        allClasses.push(...sub.classes.split(/\s+/).filter(Boolean))
      }
      changed = true
      needsReact = true

      let rendered: string
      if (subComponents.length > 0 && compName) {
        rendered = renderCompoundComponent(tag, classes ?? "", compName, subComponents, {
          addDataAttr,
        })
      } else {
        rendered = renderStaticComponent(tag, classes ?? "", {
          addDataAttr,
          isServer: rscAnalysis.isServer || isServerOnly,
          compName: compName ?? undefined,
        })
      }

      replacements.push({
        match: fullMatch,
        replacement: isServerOnly ? `/* @server-only */ ${rendered}` : rendered,
      })
    }

    // Apply replacements in reverse order to preserve offsets
    for (const { match, replacement } of replacements) {
      code = code.replace(match, replacement)
    }
  }

  // ── STEP 3b: tw.tag({...}) → lookup table + variant forwardRef ─────────
  code = code.replace(
    OBJECT_RE,
    (match, serverMark: string | undefined, tag: string, objectStr: string) => {
      const { base, variants, compounds, defaults } = parseObjectConfig(objectStr)
      let config: ComponentConfig = {
        base,
        variants,
        compoundVariants: compounds,
        defaultVariants: defaults,
      }

      const registry = getGlobalRegistry()
      if (registry.transforms.length > 0) {
        const componentName = `Tw${tag}`
        for (const transform of registry.transforms) {
          try {
            const transformed = transform(config, { componentName, tag })
            if (transformed && typeof transformed === "object") {
              config = {
                base: typeof transformed.base === "string" ? transformed.base : config.base,
                variants: isVariantRecord(transformed.variants)
                  ? transformed.variants
                  : config.variants,
                compoundVariants: isCompoundVariantsArray(transformed.compoundVariants)
                  ? transformed.compoundVariants
                  : config.compoundVariants,
                defaultVariants: isStringRecord(transformed.defaultVariants)
                  ? transformed.defaultVariants
                  : config.defaultVariants,
              }
            }
          } catch (error) {
            if (process.env.NODE_ENV !== "production") {
              console.warn("[tailwind-styled] plugin transform error:", error)
            }
          }
        }
      }

      const nextBase = normalizeClasses(config.base) ?? ""
      const nextVariants = config.variants as Record<string, Record<string, string>>
      const nextCompounds = config.compoundVariants
      const nextDefaults = config.defaultVariants
      if (!nextBase && Object.keys(nextVariants).length === 0) return match

      const isServerOnly = !!serverMark

      allClasses.push(...nextBase.split(/\s+/).filter(Boolean))
      for (const vMap of Object.values(nextVariants) as Array<Record<string, string>>) {
        for (const cls of Object.values(vMap)) {
          allClasses.push(...cls.split(/\s+/).filter(Boolean))
        }
      }

      changed = true
      needsReact = true

      const id = genId()
      // FIX #01: compileVariants no longer merges base into table
      const compiled = compileVariants(nextBase, nextVariants, nextCompounds, nextDefaults)
      prelude.push(generateVariantCode(id, compiled))

      const variantKeys = Object.keys(nextVariants)
      const rendered = renderVariantComponent(tag, id, nextBase, variantKeys, nextDefaults, {
        addDataAttr,
        isServer: rscAnalysis.isServer || isServerOnly,
      })

      return isServerOnly ? `/* @server-only */ ${rendered}` : rendered
    }
  )

  // ── STEP 3c: tw(Component)`classes` ─────────────────────────────────────
  code = code.replace(WRAP_RE, (match, compName: string, content: string) => {
    if (isDynamic(content)) return match

    const classes = normalizeClasses(content)
    if (!classes) return match

    allClasses.push(...classes.split(/\s+/).filter(Boolean))
    changed = true
    needsReact = true

    return `React.forwardRef(function _TwWrap_${compName}(props, ref) {
  var _c = [${JSON.stringify(classes)}, props.className].filter(Boolean).join(" ");
  return React.createElement(${compName}, Object.assign({}, props, { ref, className: _c }));
})`
  })

  // ── STEP 3d: Component.extend`classes` ──────────────────────────────────
  code = code.replace(EXTEND_RE, (match, compName: string, content: string) => {
    if (isDynamic(content)) return match

    const extra = normalizeClasses(content)
    if (!extra) return match

    allClasses.push(...extra.split(/\s+/).filter(Boolean))
    changed = true
    needsReact = true

    return `React.forwardRef(function _TwExt_${compName}(props, ref) {
  var _c = [${JSON.stringify(extra)}, props.className].filter(Boolean).join(" ");
  return React.createElement(${compName}, Object.assign({}, props, { ref, className: _c }));
})`
  })

  if (!changed) {
    return { code: source, classes: [], rsc: rscAnalysis, changed: false }
  }

  // ── STEP 4: Inject variant lookup tables (prelude) ─────────────────────
  if (prelude.length > 0) {
    const importEnd = findAfterImports(code)
    code = `${code.slice(0, importEnd)}\n${prelude.join("\n")}\n${code.slice(importEnd)}`
  }

  // ── STEP 5: Ensure React import ─────────────────────────────────────────
  if (needsReact && !hasReactImport(source)) {
    code = `import React from "react";\n${code}`
  }

  // ── STEP 6: RSC auto client boundary ────────────────────────────────────
  if (autoClientBoundary && rscAnalysis.needsClientDirective) {
    code = injectClientDirective(code)
  }

  // ── STEP 7: Strip tw import when fully transformed ──────────────────────
  // Skip when preserveImports — keeps cv, cx, cn, etc in the output
  if (!preserveImports) {
    const stillUsesTw = /\btw\.(server\.)?\w+[`(]/.test(code) || /\btw\(\w+\)/.test(code)
    if (!stillUsesTw) {
      code = code.replace(
        /import\s*\{[^}]*\btw\b[^}]*\}\s*from\s*["']tailwind-styled-v4["'];?\n?/g,
        ""
      )
    }
  }

  // ── STEP 8: Inject transform marker (FIX #08 — idempotency) ─────────────
  code = `${TRANSFORM_MARKER}\n${code}`

  return {
    code,
    classes: Array.from(new Set(allClasses)),
    rsc: {
      isServer: rscAnalysis.isServer,
      needsClientDirective: rscAnalysis.needsClientDirective,
      clientReasons: rscAnalysis.clientReasons,
    },
    changed: true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObjectRecord(value) && Object.values(value).every((entry) => typeof entry === "string")
}

function isVariantRecord(value: unknown): value is Record<string, Record<string, string>> {
  return isObjectRecord(value) && Object.values(value).every((entry) => isStringRecord(entry))
}

function isCompoundVariantsArray(
  value: unknown
): value is Array<{ class: string; [key: string]: any }> {
  return (
    Array.isArray(value) &&
    value.every((entry) => isObjectRecord(entry) && typeof entry.class === "string")
  )
}

function hasReactImport(source: string): boolean {
  return (
    source.includes("import React") ||
    source.includes("from 'react'") ||
    source.includes('from "react"')
  )
}

function findAfterImports(source: string): number {
  const lines = source.split("\n")
  let lastImportIdx = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (
      line.startsWith("import ") ||
      line.startsWith('"use client"') ||
      line.startsWith("'use client'") ||
      line.startsWith(TRANSFORM_MARKER) ||
      line === ""
    ) {
      lastImportIdx = i
    } else if (line && !line.startsWith("//") && !line.startsWith("/*")) {
      break
    }
  }

  return lines.slice(0, lastImportIdx + 1).join("\n").length + 1
}

export { hasTwUsage as shouldProcess }
