import { dirname, extname, join, normalize, resolve } from "node:path";
import type { MarkdownFile } from "../fs/markdownFiles.js";

export type ParsedDocumentLink =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "remoteMarkdown"; readonly url: string }
  | { readonly kind: "internal"; readonly target: string };

export function firstDocumentLink(line: string): ParsedDocumentLink | undefined {
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/.exec(line);
  if (markdownLink?.[1] !== undefined) {
    const target = markdownLink[1].trim().replace(/^<|>$/g, "");
    const external = normalizeHttpUrl(target);
    if (external === undefined) {
      return { kind: "internal", target };
    }
    return isRemoteMarkdownUrl(external) ? { kind: "remoteMarkdown", url: external } : { kind: "external", url: external };
  }

  const wikiLink = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/.exec(line);
  if (wikiLink?.[1] !== undefined) {
    return { kind: "internal", target: wikiLink[1].trim() };
  }

  const bareUrl = /(?:https?:\/\/[^\s)]+|www\.[^\s)]+)/.exec(line);
  if (bareUrl === null) {
    return undefined;
  }
  const normalized = normalizeHttpUrl(bareUrl[0].replace(/[.,;:!?]+$/, "").startsWith("www.") ? `https://${bareUrl[0].replace(/[.,;:!?]+$/, "")}` : bareUrl[0].replace(/[.,;:!?]+$/, ""));
  if (normalized === undefined) {
    return undefined;
  }
  return isRemoteMarkdownUrl(normalized) ? { kind: "remoteMarkdown", url: normalized } : { kind: "external", url: normalized };
}

export function firstRenderedDocumentLink(line: string): ParsedDocumentLink | undefined {
  const candidates: Array<{ readonly index: number; readonly link: ParsedDocumentLink }> = [];
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/.exec(line);
  const markdownTarget = markdownLink?.[1]?.trim().replace(/^<|>$/g, "");
  if (markdownLink !== null && markdownTarget !== undefined && markdownTarget.length > 0) {
    candidates.push({ index: markdownLink.index, link: linkFromTarget(markdownTarget) });
  }

  const wikiLink = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/.exec(line);
  if (wikiLink?.[1] !== undefined) {
    candidates.push({ index: wikiLink.index, link: { kind: "internal", target: wikiLink[1].trim() } });
  }

  const bareUrl = /(?:https?:\/\/[^\s)]+|www\.[^\s)]+)/.exec(line);
  if (bareUrl !== null) {
    const normalized = normalizeHttpUrl(bareUrl[0].replace(/[.,;:!?]+$/, "").startsWith("www.") ? `https://${bareUrl[0].replace(/[.,;:!?]+$/, "")}` : bareUrl[0].replace(/[.,;:!?]+$/, ""));
    if (normalized !== undefined) {
      candidates.push({ index: bareUrl.index, link: isRemoteMarkdownUrl(normalized) ? { kind: "remoteMarkdown", url: normalized } : { kind: "external", url: normalized } });
    }
  }

  const renderedInlineLink = /\(([^)]+)\)/g;
  for (;;) {
    const match = renderedInlineLink.exec(line);
    if (match === null) {
      break;
    }
    const target = match[1]?.trim().replace(/^<|>$/g, "");
    if (target === undefined || target.length === 0) {
      continue;
    }
    const link = linkFromRenderedTarget(target);
    if (link !== undefined) {
      candidates.push({ index: match.index, link });
    }
  }

  return candidates.sort((left, right) => left.index - right.index)[0]?.link;
}

function linkFromTarget(target: string): ParsedDocumentLink {
  const external = normalizeHttpUrl(target);
  if (external !== undefined) {
    return isRemoteMarkdownUrl(external) ? { kind: "remoteMarkdown", url: external } : { kind: "external", url: external };
  }
  return { kind: "internal", target };
}

function linkFromRenderedTarget(target: string): ParsedDocumentLink | undefined {
  const external = normalizeHttpUrl(target);
  if (external !== undefined) {
    return isRemoteMarkdownUrl(external) ? { kind: "remoteMarkdown", url: external } : { kind: "external", url: external };
  }
  return isPotentialInternalMarkdownTarget(target) ? { kind: "internal", target } : undefined;
}

export function resolveInternalMarkdownFile(files: readonly MarkdownFile[], currentFile: MarkdownFile, target: string): MarkdownFile | undefined {
  const cleanTarget = target.split("#", 1)[0]?.trim();
  if (cleanTarget === undefined || cleanTarget.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(cleanTarget)) {
    return undefined;
  }

  const candidates = candidateRelativePaths(currentFile.relativePath, cleanTarget);
  return files.find((file) => candidates.has(normalizePath(file.relativePath))) ?? findByWikiStem(files, cleanTarget);
}

function candidateRelativePaths(currentRelativePath: string, target: string): Set<string> {
  const baseDirectory = dirname(currentRelativePath);
  const withExtension = extname(target).length > 0 ? [target] : [`${target}.md`, `${target}.markdown`, target];
  return new Set(
    withExtension.flatMap((candidate) => [normalizePath(candidate), normalizePath(join(baseDirectory, candidate))]),
  );
}

function findByWikiStem(files: readonly MarkdownFile[], target: string): MarkdownFile | undefined {
  const normalizedTarget = normalizePath(target).replace(/\.(?:md|markdown|mdown|mkdn|mkd)$/i, "").toLowerCase();
  return files.find((file) => normalizePath(file.relativePath).replace(/\.(?:md|markdown|mdown|mkdn|mkd)$/i, "").toLowerCase() === normalizedTarget);
}

function normalizePath(path: string): string {
  return normalize(resolve("/", path)).slice(1);
}

function normalizeHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isRemoteMarkdownUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(?:md|markdown|mdown|mkdn|mkd)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isPotentialInternalMarkdownTarget(target: string): boolean {
  const cleanTarget = target.split("#", 1)[0]?.trim();
  if (cleanTarget === undefined || cleanTarget.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(cleanTarget)) {
    return false;
  }
  return /\.(?:md|markdown|mdown|mkdn|mkd)$/i.test(cleanTarget) || /^[.\w~/-]+$/.test(cleanTarget);
}
