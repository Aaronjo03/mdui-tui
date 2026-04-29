import type { InlineSegment, MarkdownBlock, MarkdownDocument, TableAlignment } from "../markdown/types.js";
import { ansi, paint, visibleLength } from "./ansi.js";
import { wrapLine } from "./wrap.js";

export interface RenderOptions {
  readonly width: number;
  readonly color: boolean;
  readonly theme?: MarkdownTheme;
}

export interface MarkdownTheme {
  readonly headingPrimary: readonly string[];
  readonly headingSecondary: readonly string[];
  readonly strong: readonly string[];
  readonly emphasis: readonly string[];
  readonly inlineCode: readonly string[];
  readonly linkText: readonly string[];
  readonly linkUrl: readonly string[];
  readonly blockquote: readonly string[];
  readonly codeBlock: readonly string[];
  readonly muted: readonly string[];
  readonly tableHeader: readonly string[];
  readonly listMarker: readonly string[];
}

export const defaultMarkdownTheme: MarkdownTheme = {
  headingPrimary: [ansi.bold, ansi.cyan],
  headingSecondary: [ansi.bold, ansi.green],
  strong: [ansi.bold],
  emphasis: [ansi.italic],
  inlineCode: [ansi.inverse],
  linkText: [ansi.underline, ansi.cyan],
  linkUrl: [ansi.gray],
  blockquote: [ansi.gray, ansi.italic],
  codeBlock: [ansi.yellow],
  muted: [ansi.gray],
  tableHeader: [ansi.bold],
  listMarker: [ansi.cyan],
};

export function renderDocument(document: MarkdownDocument, options: RenderOptions): string[] {
  const lines: string[] = [];
  for (const block of document.blocks) {
    appendBlock(lines, block, options);
  }
  while (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function appendBlock(lines: string[], block: MarkdownBlock, options: RenderOptions): void {
  const theme = options.theme ?? defaultMarkdownTheme;
  switch (block.kind) {
    case "heading": {
      const prefix = `${"#".repeat(block.depth)} `;
      const text = `${prefix}${renderInline(block.content, options.color, theme)}`;
      lines.push(style(text, options.color, ...(block.depth <= 2 ? theme.headingPrimary : theme.headingSecondary)));
      lines.push("");
      return;
    }
    case "paragraph": {
      lines.push(...wrapLine(renderInline(block.content, options.color, theme), options.width));
      lines.push("");
      return;
    }
    case "blockquote": {
      const content = wrapLine(renderInline(block.content, options.color, theme), Math.max(8, options.width - 2), "  ");
      for (const line of content) {
        lines.push(style(`│ ${line}`, options.color, ...theme.blockquote));
      }
      lines.push("");
      return;
    }
    case "list": {
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${index + 1}. ` : "• ";
        const styledMarker = style(marker, options.color, ...theme.listMarker);
        const wrapped = wrapLine(`${styledMarker}${renderInline(item, options.color, theme)}`, options.width, " ".repeat(marker.length));
        lines.push(...wrapped);
      });
      lines.push("");
      return;
    }
    case "code": {
      lines.push(style(block.language !== undefined ? `┌─ ${block.language}` : "┌─ code", options.color, ...theme.muted));
      for (const codeLine of block.code.split("\n")) {
        lines.push(style(`│ ${codeLine}`, options.color, ...theme.codeBlock));
      }
      lines.push(style("└", options.color, ...theme.muted));
      lines.push("");
      return;
    }
    case "table": {
      lines.push(...renderTable(block.headers, block.alignments, block.rows, options.color, theme));
      lines.push("");
      return;
    }
    case "rule": {
      lines.push(style("─".repeat(Math.min(Math.max(options.width, 8), 120)), options.color, ...theme.muted));
      lines.push("");
      return;
    }
  }
}

function renderInline(segments: readonly InlineSegment[], color: boolean, theme: MarkdownTheme): string {
  return segments.map((segment) => renderInlineSegment(segment, color, theme)).join("");
}

function renderInlineSegment(segment: InlineSegment, color: boolean, theme: MarkdownTheme): string {
  switch (segment.kind) {
    case "text":
      return segment.text;
    case "strong":
      return style(segment.text, color, ...theme.strong);
    case "emphasis":
      return style(segment.text, color, ...theme.emphasis);
    case "code":
      return style(` ${segment.text} `, color, ...theme.inlineCode);
    case "link":
      return `${style(segment.text, color, ...theme.linkText)} ${style(`(${segment.href})`, color, ...theme.linkUrl)}`;
    default: {
      const exhaustive: never = segment;
      return exhaustive;
    }
  }
}

function renderTable(
  headers: readonly string[],
  alignments: readonly TableAlignment[],
  rows: readonly (readonly string[])[],
  color: boolean,
  theme: MarkdownTheme,
): string[] {
  const widths = headers.map((header, columnIndex) => {
    const rowWidths = rows.map((row) => visibleLength(row[columnIndex] ?? ""));
    return Math.max(visibleLength(header), ...rowWidths, 3);
  });

  const top = `┌${widths.map((width) => "─".repeat(width + 2)).join("┬")}┐`;
  const divider = `├${widths.map((width) => "─".repeat(width + 2)).join("┼")}┤`;
  const bottom = `└${widths.map((width) => "─".repeat(width + 2)).join("┴")}┘`;
  return [
    style(top, color, ansi.gray),
    renderTableRow(headers, widths, alignments, color, theme, true),
    style(divider, color, ansi.gray),
    ...rows.map((row) => renderTableRow(row, widths, alignments, color, theme, false)),
    style(bottom, color, ansi.gray),
  ];
}

function renderTableRow(
  row: readonly string[],
  widths: readonly number[],
  alignments: readonly TableAlignment[],
  color: boolean,
  theme: MarkdownTheme,
  header: boolean,
): string {
  const cells = widths.map((width, index) => {
    const value = row[index] ?? "";
    const alignment = alignments[index] ?? "left";
    const padded = padCell(value, width, alignment);
    return header ? style(padded, color, ...theme.tableHeader) : padded;
  });
  return style("│", color, ansi.gray) + cells.map((cell) => ` ${cell} `).join(style("│", color, ansi.gray)) + style("│", color, ansi.gray);
}

function padCell(value: string, width: number, alignment: TableAlignment): string {
  const padding = Math.max(0, width - visibleLength(value));
  if (alignment === "right") {
    return `${" ".repeat(padding)}${value}`;
  }
  if (alignment === "center") {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
  }
  return `${value}${" ".repeat(padding)}`;
}

function style(value: string, color: boolean, ...styles: readonly string[]): string {
  return color ? paint(value, ...styles) : value;
}
