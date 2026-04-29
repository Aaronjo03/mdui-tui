import { describe, expect, it } from "vitest";
import { documentStats, formatDocumentStats } from "../src/tui/documentStats.js";

describe("document stats", () => {
  it("counts readable markdown words and formats reading time", () => {
    const stats = documentStats("# Title\n\nThis is [a link](https://example.com) and `code`.");

    expect(stats.words).toBe(6);
    expect(formatDocumentStats(stats)).toBe("6 words · 1 min");
  });
});
