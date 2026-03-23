import { twMerge as twMergeOriginal } from "tailwind-merge"

import type { ThemeConfig } from "./themeReader"

export interface MergeOptions {
  prefix?: string
  separator?: string
  theme?: ThemeConfig
}

function normalizeClassInput(classLists: Array<string | undefined | null | false>): string[] {
  return classLists
    .filter(Boolean)
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0)
}

export function createTwMerge(_options: MergeOptions = {}) {
  return function twMerge(...classLists: Array<string | undefined | null | false>): string {
    const clean = normalizeClassInput(classLists)
    return twMergeOriginal(clean.join(" "))
  }
}

export const twMerge = createTwMerge()

export function mergeWithRules(
  rules: Record<string, (classes: string[]) => string>,
  ...classLists: string[]
): string {
  const base = twMerge(...classLists)
  let classes = base.split(/\s+/).filter(Boolean)

  for (const rule of Object.values(rules)) {
    const next = rule(classes)
    classes = twMerge(next).split(/\s+/).filter(Boolean)
  }

  return classes.join(" ")
}
