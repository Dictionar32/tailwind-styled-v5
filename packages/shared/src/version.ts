/** Parse semver string → { major, minor, patch } */
export function parseVersion(v: string): { major: number; minor: number; patch: number } {
  const [major = 0, minor = 0, patch = 0] = v.replace(/^v/, "").split(".").map(Number)
  return { major, minor, patch }
}

/** Check if version satisfies minimum (major.minor) */
export function satisfiesMinVersion(version: string, minVersion: string): boolean {
  const v = parseVersion(version)
  const min = parseVersion(minVersion)
  if (v.major !== min.major) return v.major > min.major
  if (v.minor !== min.minor) return v.minor > min.minor
  return v.patch >= min.patch
}
