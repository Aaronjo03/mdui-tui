export interface DocumentCursorState {
  readonly cursorLine: number;
  readonly cursorColumn: number;
  readonly cursorViewportRow: number;
}

export interface DocumentViewportState {
  readonly documentLineCount: number;
  readonly scrollTop: number;
  readonly visibleRows: number;
}

export function syncCursorToViewportState(
  cursor: DocumentCursorState,
  viewport: DocumentViewportState,
  lineLength: (lineIndex: number) => number,
): DocumentCursorState {
  if (viewport.documentLineCount <= 0) {
    return { cursorLine: 0, cursorColumn: 0, cursorViewportRow: 0 };
  }

  const firstVisibleLine = clamp(viewport.scrollTop, 0, viewport.documentLineCount - 1);
  const lastVisibleLine = clamp(firstVisibleLine + viewport.visibleRows - 1, 0, viewport.documentLineCount - 1);
  const cursorLine = cursor.cursorLine < firstVisibleLine || cursor.cursorLine > lastVisibleLine
    ? clamp(firstVisibleLine + cursor.cursorViewportRow, firstVisibleLine, lastVisibleLine)
    : clamp(cursor.cursorLine, firstVisibleLine, lastVisibleLine);

  return {
    cursorLine,
    cursorColumn: clamp(cursor.cursorColumn, 0, lineLength(cursorLine)),
    cursorViewportRow: clamp(cursorLine - firstVisibleLine, 0, Math.max(0, viewport.visibleRows - 1)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
