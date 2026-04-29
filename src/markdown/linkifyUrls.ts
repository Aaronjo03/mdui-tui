const bareUrlPattern = /(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?])/g;

export function linkifyBareUrls(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  return lines
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return linkifyLine(line);
    })
    .join("\n");
}

function linkifyLine(line: string): string {
  return line.replace(bareUrlPattern, (match: string, prefix: string, url: string, offset: number, source: string) => {
    const urlStart = offset + prefix.length;
    if (isInsideMarkdownLink(source, urlStart)) {
      return match;
    }
    const href = url.startsWith("www.") ? `https://${url}` : url;
    return `${prefix}[${url}](${href})`;
  });
}

function isInsideMarkdownLink(source: string, urlStart: number): boolean {
  const before = source.slice(0, urlStart);
  const lastOpenBracket = before.lastIndexOf("[");
  const lastCloseBracket = before.lastIndexOf("]");
  const lastOpenParen = before.lastIndexOf("(");
  const lastCloseParen = before.lastIndexOf(")");

  return lastOpenBracket > lastCloseBracket || (lastOpenParen > lastCloseParen && lastCloseBracket > lastOpenBracket);
}
