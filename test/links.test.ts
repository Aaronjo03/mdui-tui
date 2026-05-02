import { describe, expect, it } from "vitest";
import type { MarkdownFile } from "../src/fs/markdownFiles.js";
import { firstDocumentLink, firstRenderedDocumentLink, renderedDocumentLinkAt, resolveInternalMarkdownFile } from "../src/markdown/links.js";

describe("document link helpers", () => {
  const files: readonly MarkdownFile[] = [makeFile("README.md"), makeFile("docs/guide.md"), makeFile("notes/Daily Note.md")];

  it("distinguishes external, relative markdown, and wikilinks", () => {
    expect(firstDocumentLink("[site](https://example.com)")).toEqual({ kind: "external", url: "https://example.com/" });
    expect(firstDocumentLink("[guide](docs/guide.md)")).toEqual({ kind: "internal", target: "docs/guide.md" });
    expect(firstDocumentLink("[[Daily Note]]")).toEqual({ kind: "internal", target: "Daily Note" });
  });

  it("classifies remote Markdown URLs separately from browser links", () => {
    expect(firstDocumentLink("[pricing](https://telnyx.com/pricing.md)")).toEqual({ kind: "remoteMarkdown", url: "https://telnyx.com/pricing.md" });
    expect(firstDocumentLink("https://telnyx.com/pricing.md")).toEqual({ kind: "remoteMarkdown", url: "https://telnyx.com/pricing.md" });
    expect(firstDocumentLink("https://telnyx.com/pricing")).toEqual({ kind: "external", url: "https://telnyx.com/pricing" });
  });

  it("finds links on rendered rows without raw source-line indexing", () => {
    expect(firstRenderedDocumentLink("Guide (docs/guide.md)")).toEqual({ kind: "internal", target: "docs/guide.md" });
    expect(firstRenderedDocumentLink("Guide (guide)")).toEqual({ kind: "internal", target: "guide" });
    expect(firstRenderedDocumentLink("Pricing (https://telnyx.com/pricing.md)")).toEqual({ kind: "remoteMarkdown", url: "https://telnyx.com/pricing.md" });
    expect(firstRenderedDocumentLink("Site (https://example.com)")).toEqual({ kind: "external", url: "https://example.com/" });
    expect(firstRenderedDocumentLink("No link (just text)")).toBeUndefined();
  });

  it("returns the earliest valid rendered link candidate", () => {
    expect(firstRenderedDocumentLink("Guide (guide) and Site (https://example.com)")).toEqual({ kind: "internal", target: "guide" });
    expect(firstRenderedDocumentLink("Guide (docs/guide.md) and Pricing (https://telnyx.com/pricing.md)")).toEqual({ kind: "internal", target: "docs/guide.md" });
  });

  it("finds the rendered link under the cursor instead of the first link on the row", () => {
    const line = "Guide (guide) and Pricing (https://telnyx.com/pricing.md)";

    expect(renderedDocumentLinkAt(line, line.indexOf("guide") + 1)).toEqual({ kind: "internal", target: "guide" });
    expect(renderedDocumentLinkAt(line, line.indexOf("pricing.md") + 1)).toEqual({ kind: "remoteMarkdown", url: "https://telnyx.com/pricing.md" });
    expect(renderedDocumentLinkAt(line, line.indexOf("and"))).toBeUndefined();
  });

  it("finds bare rendered URLs under the cursor in command snippets", () => {
    const line = "│ mdui https://telnyx.com/pricing.md";

    expect(renderedDocumentLinkAt(line, line.indexOf("mdui") + 1)).toBeUndefined();
    expect(renderedDocumentLinkAt(line, line.indexOf("telnyx") + 1)).toEqual({ kind: "remoteMarkdown", url: "https://telnyx.com/pricing.md" });
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
