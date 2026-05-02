import { describe, expect, it } from "vitest";
import { closestSearchMatchIndex, findSearchMatches, wrapSearchMatchIndex } from "../src/tui/search.js";

describe("document search helpers", () => {
  it("finds case-insensitive overlapping matches", () => {
    expect(findSearchMatches(["Banana", "band"], "ana")).toEqual([
      { line: 0, column: 1, length: 3 },
      { line: 0, column: 3, length: 3 },
    ]);
  });

  it("chooses the closest match at or after the cursor and wraps indices", () => {
    const matches = findSearchMatches(["alpha", "beta", "alpha"], "alpha");

    expect(closestSearchMatchIndex(matches, 1, 0)).toBe(1);
    expect(closestSearchMatchIndex(matches, 3, 0)).toBe(0);
    expect(wrapSearchMatchIndex(-1, matches.length)).toBe(1);
    expect(wrapSearchMatchIndex(2, matches.length)).toBe(0);
  });
});
