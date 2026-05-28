import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverMduiConfig, mduiConfigSchema, parseMduiConfig } from "../src/config/config.js";

describe("MDUI config", () => {
  it("keeps only safe data settings", () => {
    expect(
      parseMduiConfig({
        includeHidden: true,
        maxDepth: 4,
        ignoredDirectories: ["vendor", "tmp-notes"],
        pdfOutputDirectory: "./out",
        command: "rm -rf /",
        maxDepthTooHigh: 100,
      }),
    ).toEqual({
      includeHidden: true,
      maxDepth: 4,
      ignoredDirectories: ["vendor", "tmp-notes"],
      pdfOutputDirectory: "./out",
    });
  });

  it("rejects malformed values", () => {
    expect(
      parseMduiConfig({
        includeHidden: "yes",
        maxDepth: 99,
        ignoredDirectories: ["nested/path"],
        pdfOutputDirectory: "",
      }),
    ).toEqual({});
  });

  it("exports a reusable Zod schema for strict config validation", () => {
    expect(mduiConfigSchema.safeParse({ includeHidden: true, maxDepth: 8 }).success).toBe(true);
    expect(mduiConfigSchema.safeParse({ includeHidden: "true", maxDepth: 33 }).success).toBe(false);
    expect(mduiConfigSchema.safeParse({ command: "rm -rf /" }).success).toBe(false);
  });

  it("discovers JSON config from parent directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdui-config-test-"));
    const child = join(root, "docs", "nested");
    await mkdir(child, { recursive: true });
    await writeFile(join(root, ".mdui.json"), JSON.stringify({ includeHidden: true, maxDepth: 3, command: "ignored" }));

    try {
      const result = await discoverMduiConfig(child);

      expect(result.path).toBe(join(root, ".mdui.json"));
      expect(result.config).toEqual({ includeHidden: true, maxDepth: 3 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honors MDUI_CONFIG as an explicit config path", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdui-config-test-"));
    const configPath = join(root, "custom.json");
    const previousConfig = process.env.MDUI_CONFIG;
    await writeFile(configPath, JSON.stringify({ maxDepth: 2 }));

    try {
      process.env.MDUI_CONFIG = configPath;
      const result = await discoverMduiConfig(root);

      expect(result.path).toBe(configPath);
      expect(result.config).toEqual({ maxDepth: 2 });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.MDUI_CONFIG;
      } else {
        process.env.MDUI_CONFIG = previousConfig;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
