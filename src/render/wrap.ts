import { stripAnsi, visibleLength } from "./ansi.js";

export function wrapLine(line: string, width: number, indent = ""): string[] {
  const safeWidth = Math.max(8, width);
  if (visibleLength(line) <= safeWidth) {
    return [line];
  }

  const words = line.split(/(\s+)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = `${current}${word}`;
    if (current.length > 0 && visibleLength(candidate) > safeWidth) {
      lines.push(current.trimEnd());
      current = `${indent}${word.trimStart()}`;
    } else if (visibleLength(word) > safeWidth) {
      if (current.trim().length > 0) {
        lines.push(current.trimEnd());
      }
      const chunks = hardWrap(word, safeWidth, indent);
      const last = chunks.at(-1);
      lines.push(...chunks.slice(0, -1));
      current = last ?? "";
    } else {
      current = candidate;
    }
  }

  if (current.trim().length > 0) {
    lines.push(current.trimEnd());
  }

  return lines.length === 0 ? [""] : lines;
}

function hardWrap(value: string, width: number, indent: string): string[] {
  const plain = stripAnsi(value);
  const chars = Array.from(plain);
  const lines: string[] = [];
  let current = "";

  for (const char of chars) {
    const candidate = `${current}${char}`;
    if (visibleLength(candidate) > width) {
      lines.push(current);
      current = `${indent}${char}`;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}
