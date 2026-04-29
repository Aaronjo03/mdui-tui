import type { MarkdownFile } from "../fs/markdownFiles.js";

export interface RankedFile {
  readonly file: MarkdownFile;
  readonly score: number;
}

export function filterFiles(files: readonly MarkdownFile[], query: string): readonly RankedFile[] {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length === 0) {
    return files.map((file, index) => ({ file, score: 10_000 - index }));
  }

  return files
    .map((file) => ({ file, score: scoreFile(file, normalizedQuery) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.file.relativePath.localeCompare(right.file.relativePath));
}

function scoreFile(file: MarkdownFile, query: string): number {
  const path = normalize(file.relativePath);
  const name = normalize(file.name);

  if (name === query) {
    return 10_000;
  }
  if (name.startsWith(query)) {
    return 8_000 - name.length;
  }
  if (path.includes(query)) {
    return 6_000 - path.indexOf(query);
  }

  const fuzzy = fuzzyScore(path, query);
  if (fuzzy === 0) {
    return 0;
  }
  return 1_000 + fuzzy;
}

function fuzzyScore(value: string, query: string): number {
  let queryIndex = 0;
  let score = 0;
  let streak = 0;

  for (const [index, char] of Array.from(value).entries()) {
    if (char !== query[queryIndex]) {
      streak = 0;
      continue;
    }
    score += 10 + streak * 5;
    if (index === 0 || value[index - 1] === "/" || value[index - 1] === "-" || value[index - 1] === "_") {
      score += 20;
    }
    streak += 1;
    queryIndex += 1;
    if (queryIndex === query.length) {
      return score;
    }
  }

  return 0;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
