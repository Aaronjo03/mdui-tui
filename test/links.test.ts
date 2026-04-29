import { describe, expect, it } from "vitest";
import type { MarkdownFile } from "../src/fs/markdownFiles.js";
import { firstDocumentLink, resolveInternalMarkdownFile } from "../src/markdown/links.js";

describe("document link helpers", () => {
  const files: readonly MarkdownFile[] = [makeFile("README.md"), makeFile("docs/guide.md"), makeFile("notes/Daily Note.md")];

  it("distinguishes external, relative markdown, and wikilinks", () => {
    expect(firstDocumentLink("[site](https://example.com)")).toEqual({ kind: "external", url: "https://example.com/" });
    expect(firstDocumentLink("[guide](docs/guide.md)")).toEqual({ kind: "internal", target: "docs/guide.md" });
    expect(firstDocumentLink("[[Daily Note]]")).toEqual({ kind: "internal", target: "Daily Note" });
  });

  it("resolves relative markdown links and wikilinks to discovered files", () => {
    expect(resolveInternalMarkdownFile(files, makeFile("README.md"), "docs/guide.md")?.relativePath).toBe("docs/guide.md");
    expect(resolveInternalMarkdownFile(files, makeFile("docs/current.md"), "guide")?.relativePath).toBe("docs/guide.md");
    expect(resolveInternalMarkdownFile(files, makeFile("README.md"), "notes/Daily Note")?.relativePath).toBe("notes/Daily Note.md");
  });
});

function makeFile(relativePath: string): MarkdownFile {
  const segments = relativePath.split("/");
  const name = segments[segments.length - 1] ?? relativePath;
  return {
    absolutePath: `/workspace/${relativePath}`,
    relativePath,
    name,
    modifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    sizeBytes: 1,
  };
}
