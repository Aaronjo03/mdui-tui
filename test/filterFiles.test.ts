import { describe, expect, it } from "vitest";
import type { MarkdownFile } from "../src/fs/markdownFiles.js";
import { filterFiles } from "../src/finder/filterFiles.js";

describe("filterFiles", () => {
  it("prefers exact and prefix basename matches", () => {
    const files = [makeFile("docs/reference.md"), makeFile("README.md"), makeFile("samples/commands.md")];

    const result = filterFiles(files, "read");

    expect(result[0]?.file.relativePath).toBe("README.md");
  });

  it("supports fuzzy path matching", () => {
    const files = [makeFile("samples/commands.md"), makeFile("notes/glow-behavior.md")];

    const result = filterFiles(files, "cmd");

    expect(result.map((ranked) => ranked.file.relativePath)).toContain("samples/commands.md");
  });

  it("returns all files in input order for an empty query", () => {
    const files = [makeFile("a.md"), makeFile("b.md")];

    expect(filterFiles(files, "").map((ranked) => ranked.file.relativePath)).toEqual(["a.md", "b.md"]);
  });
});

function makeFile(relativePath: string): MarkdownFile {
  const segments = relativePath.split("/");
  const finalSegment = segments[segments.length - 1];
  return {
    absolutePath: `/tmp/${relativePath}`,
    relativePath,
    name: finalSegment ?? relativePath,
    modifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    sizeBytes: 42,
  };
}
