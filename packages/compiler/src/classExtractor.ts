/**
 * tailwind-styled-v4 — classExtractor
 *
 * FIX #02: Remove .slice(0, -1) workaround for broken TEMPLATE_RE.
 * TEMPLATE_RE trailing space is now fixed in twDetector.ts.
 *
 * Ekstrak semua Tailwind class dari source untuk safelist generation.
 */

import { parseComponentConfig } from "./astParser"
import { EXTEND_RE, OBJECT_RE, TEMPLATE_RE } from "./twDetector"

const VALID_CLASS_RE = /^[-a-z0-9:/[\]!.()+%]+$/
const TEMPLATE_SCAN_RE = new RegExp(TEMPLATE_RE.source, "g")
const OBJECT_SCAN_RE = new RegExp(OBJECT_RE.source, "g")
const EXTEND_SCAN_RE = new RegExp(EXTEND_RE.source, "g")
const CLASS_NAME_RE = /className\s*=\s*["']([^"']+)["']/g

function resetRegex(regex: RegExp): void {
  regex.lastIndex = 0
}

function parseClasses(raw: string): string[] {
  const parsed: string[] = []

  for (const token of raw.split(/[\n\s]+/)) {
    if (!token) continue
    const normalized = token.trim()
    if (!normalized || !VALID_CLASS_RE.test(normalized)) continue
    parsed.push(normalized)
  }

  return parsed
}

/**
 * Extract all Tailwind classes from source code.
 * 
 * v5 CHANGE: Now THROWS if native binding is unavailable.
 * Previously fell back to JS implementation.
 * 
 * @param source - Source code to extract classes from
 * @returns Array of unique class names (sorted)
 * @throws Error if native binding is not available
 */
export function extractAllClasses(source: string): string[] {
  // v5: Use native bridge - throws if unavailable
  const { getNativeBridge } = require("./nativeBridge") as typeof import("./nativeBridge")
  const native = getNativeBridge() // throws if binding unavailable
  
  // v5: Native is required - throw if method not available
  if (!native?.extractClassesFromSourceNative) {
    throw new Error(
      `[tailwind-styled/compiler v5] extractClassesFromSourceNative is required but not available.\n` +
      `Please ensure the native module is properly built.`
    )
  }
  
  const result = native.extractClassesFromSourceNative(source)
  if (!result || result.length < 0) {
    throw new Error(
      `[tailwind-styled/compiler v5] extractClassesFromSourceNative returned invalid result.`
    )
  }
  
  return result.sort()
}

export { parseClasses }
// Re-export for backward compat — now use parseComponentConfig from astParser
export function extractBaseFromObject(objectStr: string): string {
  return parseComponentConfig(objectStr).base
}
export function extractVariantsFromObject(
  objectStr: string
): Record<string, Record<string, string>> {
  return parseComponentConfig(objectStr).variants
}
