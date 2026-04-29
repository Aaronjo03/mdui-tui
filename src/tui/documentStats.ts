export interface DocumentStats {
  readonly words: number;
  readonly readingMinutes: number;
}

const wordsPerMinute = 200;

export function documentStats(markdown: string): DocumentStats {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[>#*_~\-+=[\]()`|]/g, " ");
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.length ?? 0;
  return {
    words,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / wordsPerMinute)),
  };
}

export function formatDocumentStats(stats: DocumentStats): string {
  const wordLabel = stats.words === 1 ? "word" : "words";
  const minuteLabel = stats.readingMinutes === 1 ? "min" : "mins";
  return `${stats.words} ${wordLabel} · ${stats.readingMinutes} ${minuteLabel}`;
}
