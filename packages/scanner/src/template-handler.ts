export function normalizeClassToken(token: string): string | null {
  const normalized = token.trim()
  if (!normalized) return null
  if (normalized.includes("${")) return null
  return normalized
}

export function splitClassTokens(input: string): string[] {
  const classes: string[] = []

  for (const token of input.split(/\s+/)) {
    const normalized = normalizeClassToken(token)
    if (normalized) classes.push(normalized)
  }

  return classes
}

export function extractStaticTemplateTokens(
  quasis: Array<{ value: { cooked?: string | null } }>
): string[] {
  const classes: string[] = []

  for (const quasi of quasis) {
    const cooked = quasi.value.cooked ?? ""
    if (!cooked) continue
    classes.push(...splitClassTokens(cooked))
  }

  return classes
}
