/**
 * tailwind-styled-v4 v2 — tw
 *
 * API:
 *   tw.div`p-4 bg-zinc-900`
 *   tw.button({ base: "px-4", variants: { size: { sm: "text-sm" } } })
 *   tw(Link)`underline text-blue-400`
 *   tw.server.div`p-4`   ← server-only, compiler enforced + runtime dev warning
 */

import type React from "react"
import { createComponent } from "./createComponent"
import type {
  ComponentConfig,
  TwComponentFactory,
  TwObject,
  TwServerObject,
  TwStyledComponent,
  TwTagFactory,
} from "./types"

// types.ts is single source of truth — re-export for consumers
export type { TwTagFactory, TwComponentFactory, TwObject, TwServerObject }

// ─────────────────────────────────────────────────────────────────────────────
// Template parser
// ─────────────────────────────────────────────────────────────────────────────

function parseTemplate(strings: TemplateStringsArray, exprs: any[]): string {
  return strings.raw
    .reduce((acc, str, i) => {
      const expr = exprs[i]
      const exprStr = typeof expr === "function" ? "" : (expr ?? "")
      return acc + str + String(exprStr)
    }, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// makeTag
// ─────────────────────────────────────────────────────────────────────────────

function makeTag(tag: any): TwTagFactory<any> {
  return ((
    stringsOrConfig: TemplateStringsArray | ComponentConfig,
    ...exprs: any[]
  ): TwStyledComponent<any> => {
    if (
      !Array.isArray(stringsOrConfig) &&
      typeof stringsOrConfig === "object" &&
      stringsOrConfig !== null &&
      !("raw" in stringsOrConfig)
    ) {
      return createComponent(tag, stringsOrConfig as ComponentConfig)
    }
    const classes = parseTemplate(stringsOrConfig as TemplateStringsArray, exprs)
    return createComponent(tag, classes)
  }) as TwTagFactory<any>
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML tag list
// ─────────────────────────────────────────────────────────────────────────────

const HTML_TAGS = [
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "figure",
  "figcaption",
  "details",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "s",
  "u",
  "small",
  "mark",
  "abbr",
  "cite",
  "code",
  "kbd",
  "samp",
  "var",
  "time",
  "address",
  "blockquote",
  "q",
  "del",
  "ins",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "img",
  "picture",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
  "defs",
  "use",
  "symbol",
  "form",
  "input",
  "textarea",
  "select",
  "option",
  "optgroup",
  "button",
  "label",
  "fieldset",
  "legend",
  "output",
  "progress",
  "meter",
  "datalist",
  "a",
  "area",
  "map",
  "iframe",
  "embed",
  "object",
  "pre",
  "hr",
  "br",
  "wbr",
  "dialog",
  "menu",
  "template",
  "slot",
] as const

// ─────────────────────────────────────────────────────────────────────────────
// tw.server — server-only namespace with dev warning
// ─────────────────────────────────────────────────────────────────────────────

function makeServerTag(tag: any): TwTagFactory<any> {
  const baseFactory = makeTag(tag)
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    return ((...args: any[]): TwStyledComponent<any> => {
      const tagName = typeof tag === "string" ? tag : (tag.displayName ?? "Component")
      console.warn(
        `[tailwind-styled-v4] tw.server.${tagName} rendered in browser. ` +
          `Ensure withTailwindStyled or Vite plugin is configured.`
      )
      return (baseFactory as any)(...args)
    }) as TwTagFactory<any>
  }
  return baseFactory
}

// Build server namespace — explicit type annotation so DTS bundler doesn't
// flatten it to Readonly<{}> (which happens with Object.freeze)
const serverFactories: { [K: string]: TwTagFactory<any> } = {}
for (const tag of HTML_TAGS) {
  serverFactories[tag] = makeServerTag(tag)
}

export const server: TwServerObject = serverFactories as unknown as TwServerObject

// ─────────────────────────────────────────────────────────────────────────────
// tw — main export
// ─────────────────────────────────────────────────────────────────────────────

const tagFactories: { [K: string]: TwTagFactory<any> } = {}
for (const tag of HTML_TAGS) {
  tagFactories[tag] = makeTag(tag)
}

function twCallable<C extends React.ComponentType<any>>(component: C): TwComponentFactory<C> {
  return makeTag(component) as any
}

// Explicit type annotation — TypeScript uses TwObject, DTS bundler inlines it correctly
export const tw: TwObject = Object.assign(twCallable as any, tagFactories, {
  server,
}) as unknown as TwObject
