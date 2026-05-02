export interface TocEntry {
  readonly line: number;
  readonly depth: number;
  readonly text: string;
}

export function extractToc(markdown: string): readonly TocEntry[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match === null) {
        return [];
      }
      const marker = match[1];
      const text = match[2];
      if (marker === undefined || text === undefined) {
        return [];
      }
      return [{ line: index, depth: marker.length, text: stripInlineMarkdown(text) }];
    });
}

export function formatToc(entries: readonly TocEntry[]): string {
  if (entries.length === 0) {
    return "No headings in this document.";
  }
  return entries
    .map((entry) => `${"  ".repeat(Math.max(0, entry.depth - 1))}${entry.line + 1}. ${entry.text}`)
    .join("\n");
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}
