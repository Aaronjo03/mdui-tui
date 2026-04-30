import { describe, expect, it } from "vitest";
import { syncCursorToViewportState } from "../src/tui/cursorState.js";

describe("cursor viewport synchronization", () => {
  const lineLength = (lineIndex: number): number => [4, 8, 12, 16, 20, 24, 28][lineIndex] ?? 0;

  it("preserves the cursor column when re-anchoring after a scroll", () => {
    expect(
      syncCursorToViewportState(
        { cursorLine: 0, cursorColumn: 3, cursorViewportRow: 2 },
        { documentLineCount: 7, scrollTop: 3, visibleRows: 3 },
        lineLength,
      ),
    ).toEqual({ cursorLine: 5, cursorColumn: 3, cursorViewportRow: 2 });
  });

  it("clamps the preserved column to the new line length", () => {
    expect(
      syncCursorToViewportState(
        { cursorLine: 6, cursorColumn: 30, cursorViewportRow: 0 },
        { documentLineCount: 7, scrollTop: 1, visibleRows: 3 },
        lineLength,
      ),
    ).toEqual({ cursorLine: 1, cursorColumn: 8, cursorViewportRow: 0 });
  });

  it("updates the viewport row when the cursor remains visible", () => {
    expect(
      syncCursorToViewportState(
        { cursorLine: 4, cursorColumn: 2, cursorViewportRow: 0 },
        { documentLineCount: 7, scrollTop: 3, visibleRows: 3 },
        lineLength,
      ),
    ).toEqual({ cursorLine: 4, cursorColumn: 2, cursorViewportRow: 1 });
  });
});
