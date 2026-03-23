/**
 * tailwind-styled-v4 v3 — createComponent
 *
 * v3 additions:
 *   - StateEngine integration: state key → data-attr CSS
 *   - ContainerQuery integration: container key → @container CSS
 *
 * Fixes from v2:
 *  #03 — filterProps: dynamic based on actual variant keys
 *  #07 — extend(): always use originalTag, not previous forwardRef wrapper
 */

import React from "react"
import { twMerge } from "tailwind-merge"
import { processContainer } from "./containerQuery"
import { processState } from "./stateEngine"
import type { ComponentConfig, TwStyledComponent } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Prop filter — FIX #03: dynamic based on actual variant keys
// ─────────────────────────────────────────────────────────────────────────────

const ALWAYS_BLOCKED = new Set(["base", "_ref", "state", "container", "containerName"])

function makeFilterProps(variantKeys: Set<string>) {
  return function filterProps(props: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {}
    for (const key in props) {
      if (variantKeys.has(key)) continue
      if (key.startsWith("$")) continue
      if (ALWAYS_BLOCKED.has(key)) continue
      out[key] = props[key]
    }
    return out
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant resolver
// ─────────────────────────────────────────────────────────────────────────────

function resolveVariants(
  variants: Record<string, Record<string, string>>,
  props: Record<string, any>,
  defaults: Record<string, string>
): string {
  const classes: string[] = []
  for (const key in variants) {
    const val = props[key] ?? defaults[key]
    if (val !== undefined && variants[key][String(val)]) {
      classes.push(variants[key][String(val)])
    }
  }
  return classes.join(" ")
}

function resolveCompound(
  compounds: Array<{ class: string; [key: string]: any }>,
  props: Record<string, any>
): string {
  const classes: string[] = []
  for (const compound of compounds) {
    const { class: cls, ...conditions } = compound
    const match = Object.entries(conditions).every(([k, v]) => props[k] === v)
    if (match) classes.push(cls)
  }
  return classes.join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// createComponent
// ─────────────────────────────────────────────────────────────────────────────

export function createComponent<P extends object = Record<string, any>>(
  tag: any,
  config: string | ComponentConfig
): TwStyledComponent<P> {
  const isStatic = typeof config === "string"

  const base = isStatic ? (config as string) : (config.base ?? "")
  const variants = isStatic ? {} : (config.variants ?? {})
  const compoundVariants = isStatic ? [] : (config.compoundVariants ?? [])
  const defaultVariants = isStatic ? {} : (config.defaultVariants ?? {})
  const stateConfig = isStatic ? undefined : config.state
  const containerConfig = isStatic ? undefined : config.container
  const containerName = isStatic ? undefined : config.containerName

  // Process state and container (injects CSS client-side)
  const stateResult = stateConfig
    ? processState(typeof tag === "string" ? tag : "component", stateConfig)
    : null
  const containerResult = containerConfig
    ? processContainer(typeof tag === "string" ? tag : "component", containerConfig, containerName)
    : null

  // Extra classes from state + container engines
  const engineClasses = [stateResult?.stateClass, containerResult?.containerClass]
    .filter(Boolean)
    .join(" ")

  // FIX #03: build dynamic filter based on actual variant keys
  const variantKeySet = new Set(Object.keys(variants))
  const filterProps = makeFilterProps(variantKeySet)

  const tagStr = typeof tag === "string" ? tag : (tag.displayName ?? "Component")

  // ── static shortcut ───────────────────────────────────────────────────
  if (isStatic || Object.keys(variants).length === 0) {
    const Component = React.forwardRef<any, any>((props, ref) => {
      const { className, ...rest } = props
      return React.createElement(tag, {
        ref,
        ...filterProps(rest),
        className: twMerge(base, engineClasses, className),
      })
    })

    Component.displayName = `tw.${tagStr}`
    attachExtend(Component, tag, base, config)
    return Component as unknown as TwStyledComponent<P>
  }

  // ── variant path ──────────────────────────────────────────────────────
  const Component = React.forwardRef<any, any>((props, ref) => {
    const { className } = props
    const variantClasses = resolveVariants(variants, props, defaultVariants)
    const compoundClasses = resolveCompound(compoundVariants, props)

    return React.createElement(tag, {
      ref,
      ...filterProps(props),
      className: twMerge(base, variantClasses, compoundClasses, engineClasses, className),
    })
  })

  Component.displayName = `tw.${tagStr}`
  attachExtend(Component, tag, base, config)
  return Component as unknown as TwStyledComponent<P>
}

// ─────────────────────────────────────────────────────────────────────────────
// attachExtend — FIX #07
// ─────────────────────────────────────────────────────────────────────────────

function attachExtend(
  Component: any,
  originalTag: any,
  base: string,
  config: string | ComponentConfig
) {
  Component.extend = (strings: TemplateStringsArray, ..._exprs: any[]) => {
    const extra = strings.raw.join("").trim().replace(/\s+/g, " ")
    const merged = twMerge(base, extra)
    return createComponent(
      originalTag,
      typeof config === "string" ? merged : { ...(config as ComponentConfig), base: merged }
    )
  }

  Component.withVariants = (newConfig: Partial<ComponentConfig>) => {
    const existing = typeof config === "object" ? config : {}
    return createComponent(originalTag, {
      ...existing,
      base,
      variants: { ...(existing.variants ?? undefined), ...(newConfig.variants ?? undefined) },
      compoundVariants: [
        ...(existing.compoundVariants ?? []),
        ...(newConfig.compoundVariants ?? []),
      ],
      defaultVariants: {
        ...(existing.defaultVariants ?? undefined),
        ...(newConfig.defaultVariants ?? undefined),
      },
    })
  }

  // .animate() — integrates with @tailwind-styled/animate
  // Lazy require so animate package is optional
  Component.animate = async (opts: any) => {
    try {
      const { animate: animateFn } =
        require("@tailwind-styled/animate") as typeof import("@tailwind-styled/animate")
      const animClass = await animateFn(opts)
      const merged = twMerge(base, animClass)
      return createComponent(
        originalTag,
        typeof config === "string" ? merged : { ...(config as ComponentConfig), base: merged }
      )
    } catch {
      console.warn("[tailwind-styled-v4] .animate() requires @tailwind-styled/animate")
      return Component
    }
  }
}
