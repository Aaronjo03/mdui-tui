import { describe, expect, it } from "vitest";
import { documentRenderWidth, lineNumberGutterWidth } from "../src/tui/documentRenderWidth.js";

describe("document render width helpers", () => {
  it("keeps a stable minimum line-number gutter for common document sizes", () => {
    expect(lineNumberGutterWidth(0)).toBe(5);
    expect(lineNumberGutterWidth(9)).toBe(5);
    expect(lineNumberGutterWidth(9999)).toBe(5);
    expect(lineNumberGutterWidth(10000)).toBe(6);
  });

  it("accounts for the current line-number gutter when wrapping document content", () => {
    const baseInput = {
      wrapEnabled: true,
      zoomLevel: 0,
      viewerWidth: 80,
      terminalWidth: 120,
      lineNumbersVisible: true,
    };

    expect(documentRenderWidth({ ...baseInput, lineCount: 9999 })).toBe(71);
    expect(documentRenderWidth({ ...baseInput, lineCount: 10000 })).toBe(70);
  });
});
