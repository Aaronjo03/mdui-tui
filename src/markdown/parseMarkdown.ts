import type { InlineSegment, MarkdownBlock, MarkdownDocument, TableAlignment } from "./types.js";

const headingPattern = /^(#{1,6})\s+(.+)$/;
const unorderedPattern = /^\s*[-*+]\s+(.+)$/;
const orderedPattern = /^\s*\d+[.)]\s+(.+)$/;

export function parseMarkdown(markdown: string): MarkdownDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const parsed = parseCodeFence(lines, index);
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    const table = parseTable(lines, index);
    if (table !== undefined) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading !== null) {
      const marks = heading[1];
      const content = heading[2];
      if (marks !== undefined && content !== undefined) {
        blocks.push({ kind: "heading", depth: toHeadingDepth(marks.length), content: parseInline(content) });
        index += 1;
        continue;
      }
    }

    if (/^\s{0,3}(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const parsed = parseBlockquote(lines, index);
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    if (unorderedPattern.test(line) || orderedPattern.test(line)) {
      const parsed = parseList(lines, index);
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    const paragraph = parseParagraph(lines, index);
    blocks.push(paragraph.block);
    index = paragraph.nextIndex;
  }

  return { blocks };
}

function parseCodeFence(lines: readonly string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } {
  const opener = lines[startIndex] ?? "```";
  const language = opener.slice(3).trim() || undefined;
  const codeLines: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      return { block: { kind: "code", language, code: codeLines.join("\n") }, nextIndex: index + 1 };
    }
    codeLines.push(line);
    index += 1;
  }

  return { block: { kind: "code", language, code: codeLines.join("\n") }, nextIndex: index };
}

function parseTable(lines: readonly string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } | undefined {
  const headerLine = lines[startIndex];
  const dividerLine = lines[startIndex + 1];
  if (headerLine === undefined || dividerLine === undefined || !isTableRow(headerLine) || !isDividerRow(dividerLine)) {
    return undefined;
  }

  const headers = splitTableRow(headerLine);
  const alignments = splitTableRow(dividerLine).map(parseAlignment);
  if (headers.length === 0 || alignments.length === 0) {
    return undefined;
  }

  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!isTableRow(line) || isDividerRow(line)) {
      break;
    }
    rows.push(splitTableRow(line));
    index += 1;
  }

  return { block: { kind: "table", headers, alignments, rows }, nextIndex: index };
}

function parseBlockquote(lines: readonly string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } {
  const quoteLines: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trimStart().startsWith(">")) {
      break;
    }
    quoteLines.push(line.trimStart().replace(/^>\s?/, ""));
    index += 1;
  }
  return { block: { kind: "blockquote", content: parseInline(quoteLines.join(" ")) }, nextIndex: index };
}

function parseList(lines: readonly string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } {
  const first = lines[startIndex] ?? "";
  const ordered = orderedPattern.test(first);
  const items: InlineSegment[][] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = ordered ? orderedPattern.exec(line) : unorderedPattern.exec(line);
    if (match === null) {
      break;
    }
    const item = match[1];
    if (item !== undefined) {
      items.push(parseInline(item));
    }
    index += 1;
  }

  return { block: { kind: "list", ordered, items }, nextIndex: index };
}

function parseParagraph(lines: readonly string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } {
  const paragraphLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || startsBlock(line, lines[index + 1])) {
      break;
    }
    paragraphLines.push(line.trim());
    index += 1;
  }

  return { block: { kind: "paragraph", content: parseInline(paragraphLines.join(" ")) }, nextIndex: index };
}

function startsBlock(line: string, nextLine: string | undefined): boolean {
  return (
    line.startsWith("```") ||
    headingPattern.test(line) ||
    /^\s{0,3}(-{3,}|_{3,}|\*{3,})\s*$/.test(line) ||
    line.trimStart().startsWith(">") ||
    unorderedPattern.test(line) ||
    orderedPattern.test(line) ||
    (nextLine !== undefined && isTableRow(line) && isDividerRow(nextLine))
  );
}

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = findNextInlineMatch(remaining);
    if (match === undefined) {
      segments.push({ kind: "text", text: remaining });
      break;
    }

    if (match.index > 0) {
      segments.push({ kind: "text", text: remaining.slice(0, match.index) });
    }

    segments.push(match.segment);
    remaining = remaining.slice(match.index + match.length);
  }

  return mergeAdjacentText(segments);
}

function findNextInlineMatch(text: string): { index: number; length: number; segment: InlineSegment } | undefined {
  const patterns: readonly { readonly regex: RegExp; readonly toSegment: (match: RegExpExecArray) => InlineSegment | undefined }[] = [
    { regex: /`([^`]+)`/, toSegment: (match) => segmentFromMatch("code", match) },
    { regex: /\*\*([^*]+)\*\*/, toSegment: (match) => segmentFromMatch("strong", match) },
    { regex: /__([^_]+)__/, toSegment: (match) => segmentFromMatch("strong", match) },
    { regex: /\*([^*]+)\*/, toSegment: (match) => segmentFromMatch("emphasis", match) },
    { regex: /_([^_]+)_/, toSegment: (match) => segmentFromMatch("emphasis", match) },
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      toSegment: (match) => {
        const label = match[1];
        const href = match[2];
        return label !== undefined && href !== undefined ? { kind: "link", text: label, href } : undefined;
      },
    },
  ];

  let best: { index: number; length: number; segment: InlineSegment } | undefined;
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (match === null || match.index < 0) {
      continue;
    }
    const fullMatch = match[0];
    const segment = pattern.toSegment(match);
    if (fullMatch === undefined || segment === undefined) {
      continue;
    }
    if (best === undefined || match.index < best.index) {
      best = { index: match.index, length: fullMatch.length, segment };
    }
  }
  return best;
}

function segmentFromMatch(kind: "strong" | "emphasis" | "code", match: RegExpExecArray): InlineSegment | undefined {
  const text = match[1];
  return text === undefined ? undefined : { kind, text };
}

function mergeAdjacentText(segments: readonly InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (segment.kind === "text" && previous?.kind === "text") {
      merged[merged.length - 1] = { kind: "text", text: previous.text + segment.text };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function isTableRow(line: string): boolean {
  return line.includes("|") && splitTableRow(line).length > 1;
}

function isDividerRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseAlignment(cell: string): TableAlignment {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
    return "center";
  }
  if (trimmed.endsWith(":")) {
    return "right";
  }
  return "left";
}

function toHeadingDepth(length: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (length <= 1) return 1;
  if (length === 2) return 2;
  if (length === 3) return 3;
  if (length === 4) return 4;
  if (length === 5) return 5;
  return 6;
}
