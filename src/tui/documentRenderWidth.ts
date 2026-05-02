export interface DocumentRenderWidthInput {
  readonly wrapEnabled: boolean;
  readonly zoomLevel: number;
  readonly viewerWidth: number;
  readonly terminalWidth: number;
  readonly lineCount: number;
  readonly lineNumbersVisible: boolean;
}

export function lineNumberGutterWidth(lineCount: number): number {
  return Math.max(5, String(Math.max(1, lineCount)).length + 1);
}

export function documentRenderWidth(input: DocumentRenderWidthInput): number {
  const zoomWidth = input.zoomLevel * 8;
  const viewerWidth = input.viewerWidth > 0 ? input.viewerWidth : input.terminalWidth;
  const lineNumberWidth = input.lineNumbersVisible ? lineNumberGutterWidth(input.lineCount) : 0;
  const baseWidth = Math.max(40, viewerWidth - lineNumberWidth - 4);
  return input.wrapEnabled ? clamp(baseWidth + zoomWidth, 30, 400) : 400;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
