/**
 * tailwind-styled-v4 v3 — Public Types
 *
 * New in v3:
 *   - StateConfig: data-attr reactive states
 *   - ContainerConfig: @container query support
 *   - HtmlTagName: explicit union (fixes DTS bundler collapse issue)
 */

import type React from "react"
import type { JSX } from "react"

// ─────────────────────────────────────────────────────────────────────────────
// ComponentConfig — tw.button({ base, variants, state, container, ... })
// ─────────────────────────────────────────────────────────────────────────────

/** Reactive state config — generates data-attr CSS selectors */
export interface StateConfig {
  [stateName: string]: string
}

/** Container query breakpoints */
export interface ContainerConfig {
  /** @container (min-width: Xpx) */
  [breakpoint: string]: string | { minWidth?: string; maxWidth?: string; classes: string }
}

export interface ComponentConfig {
  base?: string
  variants?: Record<string, Record<string, string>>
  compoundVariants?: Array<{ class: string; [key: string]: any }>
  defaultVariants?: Record<string, string>
  /** Reactive state: { active: "bg-blue-500", disabled: "opacity-50" } */
  state?: StateConfig
  /** Container query: { sm: "flex-col", md: "flex-row" } */
  container?: ContainerConfig
  /** Named container for @container queries */
  containerName?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE #3 — Precise variant type inference
// ─────────────────────────────────────────────────────────────────────────────

export type VariantLiterals<V extends Record<string, string>> = keyof V & string

export type InferVariantProps<C extends ComponentConfig> =
  C["variants"] extends Record<string, Record<string, string>>
    ? {
        [K in keyof C["variants"]]?: VariantLiterals<C["variants"][K]>
      }
    : // Record<string, never> kills all props on intersection — use empty object type
      Record<never, never>

export type StyledComponentProps<
  P extends object,
  C extends ComponentConfig = ComponentConfig,
> = P & InferVariantProps<C> & { className?: string }

// ─────────────────────────────────────────────────────────────────────────────
// TwStyledComponent
// ─────────────────────────────────────────────────────────────────────────────

export interface TwStyledComponent<P extends object = Record<string, any>>
  extends React.ForwardRefExoticComponent<P & React.RefAttributes<any>> {
  extend(strings: TemplateStringsArray, ...exprs: any[]): TwStyledComponent<P>
  withVariants(config: Partial<ComponentConfig>): TwStyledComponent<P>
  /** Attach a CSS animation. Requires @tailwind-styled/animate v5 async API. */
  animate(opts: import("@tailwind-styled/animate").AnimateOptions): Promise<TwStyledComponent<P>>
}

// ─────────────────────────────────────────────────────────────────────────────
// cv() return type
// ─────────────────────────────────────────────────────────────────────────────

export type CvFn<C extends ComponentConfig> = (
  props?: InferVariantProps<C> & { className?: string } & Record<string, any>
) => string

// ─────────────────────────────────────────────────────────────────────────────
// Tag factory types
// ─────────────────────────────────────────────────────────────────────────────

type Interpolation<P extends object> =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((props: P) => string | number | boolean | null | undefined)

export type TwTagFactory<E extends keyof JSX.IntrinsicElements = "div"> = {
  (
    strings: TemplateStringsArray,
    ...exprs: Interpolation<JSX.IntrinsicElements[E]>[]
  ): TwStyledComponent<JSX.IntrinsicElements[E]>
  <P extends object>(
    strings: TemplateStringsArray,
    ...exprs: Interpolation<JSX.IntrinsicElements[E] & P>[]
  ): TwStyledComponent<JSX.IntrinsicElements[E] & P>
  <C extends ComponentConfig>(
    config: C
  ): TwStyledComponent<JSX.IntrinsicElements[E] & InferVariantProps<C>>
  (config: ComponentConfig): TwStyledComponent<JSX.IntrinsicElements[E]>
}

export type TwComponentFactory<C extends React.ComponentType<any>> = {
  (
    strings: TemplateStringsArray,
    ...exprs: Interpolation<React.ComponentPropsWithRef<C>>[]
  ): TwStyledComponent<React.ComponentPropsWithRef<C>>
  <Config extends ComponentConfig>(
    config: Config
  ): TwStyledComponent<React.ComponentPropsWithRef<C> & InferVariantProps<Config>>
}

// ─────────────────────────────────────────────────────────────────────────────
// HtmlTagName — explicit union (fixes DTS bundler collapsing JSX.IntrinsicElements)
// ─────────────────────────────────────────────────────────────────────────────

export type HtmlTagName =
  | "div"
  | "section"
  | "article"
  | "aside"
  | "header"
  | "footer"
  | "main"
  | "nav"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "span"
  | "strong"
  | "em"
  | "b"
  | "i"
  | "s"
  | "u"
  | "small"
  | "mark"
  | "sub"
  | "sup"
  | "blockquote"
  | "q"
  | "cite"
  | "abbr"
  | "address"
  | "time"
  | "code"
  | "pre"
  | "kbd"
  | "samp"
  | "var"
  | "ul"
  | "ol"
  | "li"
  | "dl"
  | "dt"
  | "dd"
  | "figure"
  | "figcaption"
  | "details"
  | "summary"
  | "table"
  | "thead"
  | "tbody"
  | "tfoot"
  | "tr"
  | "th"
  | "td"
  | "caption"
  | "colgroup"
  | "col"
  | "img"
  | "picture"
  | "video"
  | "audio"
  | "source"
  | "track"
  | "canvas"
  | "svg"
  | "path"
  | "circle"
  | "rect"
  | "line"
  | "polyline"
  | "polygon"
  | "ellipse"
  | "g"
  | "defs"
  | "use"
  | "symbol"
  | "text"
  | "tspan"
  | "form"
  | "input"
  | "textarea"
  | "select"
  | "option"
  | "optgroup"
  | "button"
  | "label"
  | "fieldset"
  | "legend"
  | "output"
  | "progress"
  | "meter"
  | "datalist"
  | "a"
  | "area"
  | "map"
  | "iframe"
  | "embed"
  | "object"
  | "hr"
  | "br"
  | "wbr"
  | "dialog"
  | "menu"
  | "template"
  | "slot"

export type TwServerObject = {
  [K in HtmlTagName]: K extends keyof JSX.IntrinsicElements ? TwTagFactory<K> : TwTagFactory<"div">
}

export type TwObject = {
  [K in keyof JSX.IntrinsicElements]: TwTagFactory<K>
} & {
  <C extends React.ComponentType<any>>(component: C): TwComponentFactory<C>
  server: TwServerObject
}
