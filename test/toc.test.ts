import { describe, expect, it } from "vitest";
import { extractToc, formatToc } from "../src/tui/toc.js";

describe("table of contents helpers", () => {
  it("extracts ATX headings with line numbers", () => {
    const toc = extractToc("# Intro\ntext\n## [Usage](./usage.md) ##");

    expect(toc).toEqual([
      { line: 0, depth: 1, text: "Intro" },
      { line: 2, depth: 2, text: "Usage" },
    ]);
    expect(formatToc(toc)).toBe("1. Intro\n  3. Usage");
  });
});
