import { beforeEach, describe, expect, expectTypeOf, test, vi } from "vitest"
import { tailwindStyledPlugin, type VitePluginOptions } from "./plugin"

vi.mock("@tailwind-styled/compiler", () => ({
  runLoaderTransform: vi.fn((opts: any) => ({
    changed: false,
    code: opts.source,
  })),
  generateSafelist: vi.fn(),
}))

vi.mock("@tailwind-styled/engine", () => ({
  createEngine: vi.fn().mockResolvedValue({
    build: vi.fn(),
  }),
}))

vi.mock("@tailwind-styled/scanner", () => ({
  scanWorkspaceAsync: vi.fn().mockResolvedValue({
    totalFiles: 10,
    uniqueClasses: ["bg-red-500", "text-blue-500"],
  }),
}))

describe("tailwindStyledPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Plugin exports", () => {
    test("tailwindStyledPlugin is exported as named export", () => {
      expect(tailwindStyledPlugin).toBeDefined()
      expect(typeof tailwindStyledPlugin).toBe("function")
    })

    test("default export exists", async () => {
      const module = await import("./index")
      expect(module.default).toBeDefined()
      expect(typeof module.default).toBe("function")
    })
  })

  describe("Plugin structure", () => {
    test("plugin has correct name", () => {
      const plugin = tailwindStyledPlugin()
      expect(plugin.name).toBe("tailwind-styled-v4")
    })

    test("plugin has enforce: 'pre'", () => {
      const plugin = tailwindStyledPlugin()
      expect(plugin.enforce).toBe("pre")
    })

    test("plugin has transform hook", () => {
      const plugin = tailwindStyledPlugin()
      expect(plugin.transform).toBeDefined()
      expect(typeof plugin.transform).toBe("function")
    })

    test("plugin has buildEnd hook", () => {
      const plugin = tailwindStyledPlugin()
      expect(plugin.buildEnd).toBeDefined()
      expect(typeof plugin.buildEnd).toBe("function")
    })

    test("plugin has handleHotUpdate hook", () => {
      const plugin = tailwindStyledPlugin()
      expect(plugin.handleHotUpdate).toBeDefined()
      expect(typeof plugin.handleHotUpdate).toBe("function")
    })
  })

  describe("Default options behavior", () => {
    test("include default regex matches .tsx files", async () => {
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/src/App.tsx")

      expect(result).toBeDefined()
    })

    test("include default regex matches .ts files", async () => {
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/src/util.ts")

      expect(result).toBeDefined()
    })

    test("include default regex matches .jsx files", async () => {
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/src/Component.jsx")

      expect(result).toBeDefined()
    })

    test("include default regex matches .js files", async () => {
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/src/index.js")

      expect(result).toBeDefined()
    })

    test("exclude default regex excludes node_modules", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/node_modules/pkg/index.js")

      expect(runLoaderTransform).not.toHaveBeenCalled()
    })

    test("custom include regex is respected", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      const customInclude = /\.custom$/
      const plugin = tailwindStyledPlugin({ include: customInclude })

      const result = await plugin.transform("const x = 1", "/src/file.custom")
      const result2 = await plugin.transform("const x = 1", "/src/file.tsx")

      expect(runLoaderTransform).toHaveBeenCalledTimes(1)
    })

    test("custom exclude regex is respected", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      const customExclude = /\.skip$/
      const plugin = tailwindStyledPlugin({ exclude: customExclude })

      const result = await plugin.transform("const x = 1", "/src/file.skip")

      expect(runLoaderTransform).not.toHaveBeenCalled()
    })
  })

  describe("Transform hook", () => {
    test("runLoaderTransform is called for included files", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      const plugin = tailwindStyledPlugin()

      await plugin.transform("const x = tw`bg-red-500`", "/src/App.tsx")

      expect(runLoaderTransform).toHaveBeenCalled()
    })

    test("runLoaderTransform is not called for excluded files", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      const plugin = tailwindStyledPlugin()

      await plugin.transform("const x = 1", "/node_modules/pkg/index.js")

      expect(runLoaderTransform).not.toHaveBeenCalled()
    })

    test("runLoaderTransform called with correct options", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      vi.mocked(runLoaderTransform).mockReturnValueOnce({
        changed: true,
        code: "const x = 1",
      })

      const plugin = tailwindStyledPlugin()
      plugin.configResolved?.({ root: "/test", command: "serve" })

      await plugin.transform("const x = 1", "/src/App.tsx")

      expect(runLoaderTransform).toHaveBeenCalledWith(
        expect.objectContaining({
          filepath: "/src/App.tsx",
          source: "const x = 1",
          options: expect.objectContaining({
            mode: "zero-runtime",
            preserveImports: true,
          }),
        })
      )
    })
  })

  describe("Deprecated options", () => {
    const deprecatedOptions: (keyof VitePluginOptions)[] = [
      "mode",
      "routeCss",
      "deadStyleElimination",
      "addDataAttr",
      "autoClientBoundary",
      "hoist",
      "incremental",
    ]

    test.each(deprecatedOptions)("console.warn is called for deprecated option: %s", (option) => {
      const warnSpy = vi.spyOn(console, "warn")

      tailwindStyledPlugin({ [option]: true } as VitePluginOptions)

      expect(warnSpy).toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`'${option}' is deprecated in v5`)
      )
    })

    test("no warning when deprecated options are not used", () => {
      const warnSpy = vi.spyOn(console, "warn")

      tailwindStyledPlugin()

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe("handleHotUpdate", () => {
    test("full-reload is sent for relevant files", () => {
      const mockServer = {
        ws: {
          send: vi.fn(),
        },
      }

      const plugin = tailwindStyledPlugin()

      plugin.handleHotUpdate({
        file: "/src/App.tsx",
        server: mockServer,
      })

      expect(mockServer.ws.send).toHaveBeenCalledWith({ type: "full-reload" })
    })

    test("no full-reload for excluded files", () => {
      const mockServer = {
        ws: {
          send: vi.fn(),
        },
      }

      const plugin = tailwindStyledPlugin()

      plugin.handleHotUpdate({
        file: "/node_modules/pkg/index.js",
        server: mockServer,
      })

      expect(mockServer.ws.send).not.toHaveBeenCalled()
    })

    test("no full-reload for files not matching include", () => {
      const mockServer = {
        ws: {
          send: vi.fn(),
        },
      }

      const plugin = tailwindStyledPlugin({ include: /\.custom$/ })

      plugin.handleHotUpdate({
        file: "/src/App.tsx",
        server: mockServer,
      })

      expect(mockServer.ws.send).not.toHaveBeenCalled()
    })
  })

  describe("Edge cases", () => {
    test("empty file returns null", async () => {
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("", "/src/Empty.tsx")

      expect(result).toBeNull()
    })

    test("file without tailwind-styled classes returns null", async () => {
      const { runLoaderTransform } = await import("@tailwind-styled/compiler")
      vi.mocked(runLoaderTransform).mockReturnValueOnce({
        changed: false,
        code: "const x = 1",
      })

      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/src/App.tsx")

      expect(result).toBeNull()
    })

    test("error on generateSafelist is handled with console.warn", async () => {
      const { generateSafelist } = await import("@tailwind-styled/compiler")
      vi.mocked(generateSafelist).mockImplementationOnce(() => {
        throw new Error("Test error")
      })

      const warnSpy = vi.spyOn(console, "warn")
      const plugin = tailwindStyledPlugin({ generateSafelist: true })

      const mockConfig = { root: "/test", command: "build" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[tailwind-styled-v4] Safelist generation failed:")
      )
    })

    test("file with query string is handled", async () => {
      const plugin = tailwindStyledPlugin()

      const result = await plugin.transform("const x = 1", "/src/App.tsx?import=static")

      expect(result).toBeNull()
    })
  })

  describe("buildEnd hook", () => {
    test("generateSafelist is called with correct paths", async () => {
      const { generateSafelist } = await import("@tailwind-styled/compiler")
      const plugin = tailwindStyledPlugin({ generateSafelist: true })

      const mockConfig = { root: "/test", command: "build" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(generateSafelist).toHaveBeenCalledWith(
        ["/test/src"],
        "/test/.tailwind-styled-safelist.json",
        "/test"
      )
    })

    test("scanWorkspaceAsync is called with root", async () => {
      const { scanWorkspaceAsync } = await import("@tailwind-styled/scanner")
      const plugin = tailwindStyledPlugin()

      const mockConfig = { root: "/test", command: "build" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(scanWorkspaceAsync).toHaveBeenCalledWith("/test")
    })

    test("createEngine is called when useEngineBuild is true", async () => {
      const { createEngine } = await import("@tailwind-styled/engine")
      const plugin = tailwindStyledPlugin({ useEngineBuild: true })

      const mockConfig = { root: "/test", command: "build" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(createEngine).toHaveBeenCalledWith(
        expect.objectContaining({
          root: "/test",
          compileCss: true,
          analyze: false,
        })
      )
    })

    test("createEngine is not called when useEngineBuild is false", async () => {
      const { createEngine } = await import("@tailwind-styled/engine")
      const plugin = tailwindStyledPlugin({ useEngineBuild: false })

      const mockConfig = { root: "/test", command: "build" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(createEngine).not.toHaveBeenCalled()
    })

    test("buildEnd does nothing in dev mode", async () => {
      const { generateSafelist } = await import("@tailwind-styled/compiler")
      const { scanWorkspaceAsync } = await import("@tailwind-styled/scanner")
      const { createEngine } = await import("@tailwind-styled/engine")
      const plugin = tailwindStyledPlugin()

      const mockConfig = { root: "/test", command: "serve" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(generateSafelist).not.toHaveBeenCalled()
      expect(scanWorkspaceAsync).not.toHaveBeenCalled()
      expect(createEngine).not.toHaveBeenCalled()
    })

    test("scanReportOutput is written correctly", async () => {
      const fs = await import("node:fs")
      const writeFileSyncSpy = vi.spyOn(fs, "writeFileSync")
      const { scanWorkspaceAsync } = await import("@tailwind-styled/scanner")
      vi.mocked(scanWorkspaceAsync).mockResolvedValueOnce({
        totalFiles: 100,
        uniqueClasses: ["bg-red-500"],
      })

      const plugin = tailwindStyledPlugin({ scanReportOutput: "custom-report.json" })

      const mockConfig = { root: "/test", command: "build" }
      plugin.configResolved?.(mockConfig)
      await plugin.buildEnd()

      expect(writeFileSyncSpy).toHaveBeenCalledWith(
        "/test/custom-report.json",
        expect.stringContaining('"totalFiles": 100')
      )
    })
  })
})
