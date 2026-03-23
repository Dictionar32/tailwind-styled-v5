import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LRUCache } from "../src/cache"
import { hashContent, hashFile } from "../src/hash"
import { createLogger, type LogLevel } from "../src/logger"
import { debounce, throttle } from "../src/timing"
import { parseVersion, satisfiesMinVersion } from "../src/version"

describe("LRUCache", () => {
  it("should store and retrieve values", () => {
    const cache = new LRUCache<string, number>(3)
    cache.set("a", 1)
    expect(cache.get("a")).toBe(1)
  })

  it("should evict least recently used when full", () => {
    const cache = new LRUCache<string, number>(3)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    cache.set("d", 4) // should evict 'a'

    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")).toBe(2)
    expect(cache.get("c")).toBe(3)
    expect(cache.get("d")).toBe(4)
  })

  it("should respect TTL and expire entries", async () => {
    const cache = new LRUCache<string, number>(10, 50)
    cache.set("a", 1)
    expect(cache.get("a")).toBe(1)

    await new Promise((r) => setTimeout(r, 60))
    expect(cache.get("a")).toBeUndefined()
  })

  it("should update existing keys", () => {
    const cache = new LRUCache<string, number>(3)
    cache.set("a", 1)
    cache.set("a", 2)
    expect(cache.get("a")).toBe(2)
  })

  it("should support has, delete, clear, size", () => {
    const cache = new LRUCache<string, number>(3)
    cache.set("a", 1)
    expect(cache.has("a")).toBe(true)
    expect(cache.has("b")).toBe(false)

    cache.delete("a")
    expect(cache.has("a")).toBe(false)

    cache.set("b", 2)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it("should iterate over keys, values, entries", () => {
    const cache = new LRUCache<string, number>(3)
    cache.set("a", 1)
    cache.set("b", 2)

    expect([...cache.keys()]).toEqual(["a", "b"])
    expect([...cache.values()]).toEqual([1, 2])
    expect([...cache.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
    ])
  })
})

describe("hashContent", () => {
  it("should produce consistent hash for same content", () => {
    const h1 = hashContent("hello world")
    const h2 = hashContent("hello world")
    expect(h1).toBe(h2)
  })

  it("should produce different hash for different content", () => {
    const h1 = hashContent("hello")
    const h2 = hashContent("world")
    expect(h1).not.toBe(h2)
  })

  it("should respect algorithm parameter", () => {
    const md5 = hashContent("test", "md5")
    const sha256 = hashContent("test", "sha256")
    expect(md5).not.toBe(sha256)
  })

  it("should respect length parameter", () => {
    const short = hashContent("test", "md5", 4)
    const long = hashContent("test", "md5", 16)
    expect(short.length).toBe(4)
    expect(long.length).toBe(16)
  })
})

describe("hashFile", () => {
  let tempDir: string
  let tempFile: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hash-test-"))
    tempFile = path.join(tempDir, "test.txt")
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("should hash file content", () => {
    fs.writeFileSync(tempFile, "hello world")
    const h = hashFile(tempFile)
    expect(h).toBe(hashContent("hello world"))
  })

  it("should return fallback for non-existent file", () => {
    const h = hashFile(path.join(tempDir, "nonexistent.txt"))
    expect(h).toBe("00000000")
  })
})

describe("debounce", () => {
  it("should delay execution", async () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it("should reset timer on subsequent calls", async () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)
    debounced()
    vi.advanceTimersByTime(50)

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})

describe("throttle", () => {
  it("should execute immediately on first call", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = throttle(fn, 100)

    throttled()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it("should throttle subsequent calls", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = throttle(fn, 100)

    throttled()
    throttled()
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    throttled()
    expect(fn).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})

describe("parseVersion", () => {
  it("should parse standard semver", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it("should handle v prefix", () => {
    expect(parseVersion("v2.0.1")).toEqual({ major: 2, minor: 0, patch: 1 })
  })

  it("should handle partial versions", () => {
    expect(parseVersion("1")).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(parseVersion("1.2")).toEqual({ major: 1, minor: 2, patch: 0 })
  })

  it("should handle invalid input", () => {
    expect(parseVersion("")).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(parseVersion("abc")).toEqual({ major: 0, minor: 0, patch: 0 })
  })
})

describe("satisfiesMinVersion", () => {
  it("should return true when version meets minimum", () => {
    expect(satisfiesMinVersion("1.0.0", "1.0.0")).toBe(true)
    expect(satisfiesMinVersion("2.0.0", "1.0.0")).toBe(true)
    expect(satisfiesMinVersion("1.2.0", "1.1.0")).toBe(true)
    expect(satisfiesMinVersion("1.1.5", "1.1.0")).toBe(true)
  })

  it("should return false when version is below minimum", () => {
    expect(satisfiesMinVersion("0.9.0", "1.0.0")).toBe(false)
    expect(satisfiesMinVersion("1.0.0", "1.0.1")).toBe(false)
    expect(satisfiesMinVersion("1.0.0", "2.0.0")).toBe(false)
  })

  it("should handle v prefix", () => {
    expect(satisfiesMinVersion("v1.2.3", "1.2.0")).toBe(true)
  })
})

describe("createLogger", () => {
  let stdout: string
  let stderr: string

  beforeEach(() => {
    stdout = ""
    stderr = ""
    vi.spyOn(process.stdout, "write").mockImplementation((msg) => {
      stdout += msg
      return true
    })
    vi.spyOn(process.stderr, "write").mockImplementation((msg) => {
      stderr += msg
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should log at info level by default", () => {
    const log = createLogger("test")
    log.info("hello")
    expect(stdout).toContain("[test] hello")
  })

  it("should not log below current level", () => {
    const log = createLogger("test", "error")
    log.info("should not appear")
    expect(stdout).toBe("")
  })

  it("should log errors to stderr", () => {
    const log = createLogger("test")
    log.error("error msg")
    expect(stderr).toContain("[test] error msg")
  })

  it("should support setLevel", () => {
    const log = createLogger("test", "error")
    log.debug("should not appear")
    log.setLevel("debug")
    log.debug("should appear")
    expect(stderr).toContain("[test] should appear")
  })
})
