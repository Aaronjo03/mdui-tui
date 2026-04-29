export interface SearchMatch {
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

export function findSearchMatches(lines: readonly string[], query: string): readonly SearchMatch[] {
  if (query.length === 0) {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  const matches: SearchMatch[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    const lowerLine = line.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerLine.length) {
      const columnIndex = lowerLine.indexOf(lowerQuery, searchFrom);
      if (columnIndex < 0) {
        break;
      }
      matches.push({ line: lineIndex, column: columnIndex, length: query.length });
      searchFrom = columnIndex + 1;
    }
  }
  return matches;
}

export function closestSearchMatchIndex(matches: readonly SearchMatch[], cursorLine: number, cursorColumn: number): number {
  if (matches.length === 0) {
    return -1;
  }

  const index = matches.findIndex((match) => match.line > cursorLine || (match.line === cursorLine && match.column >= cursorColumn));
  return index >= 0 ? index : 0;
}

export function wrapSearchMatchIndex(index: number, matchCount: number): number {
  if (matchCount <= 0) {
    return -1;
  }
  return ((index % matchCount) + matchCount) % matchCount;
}
