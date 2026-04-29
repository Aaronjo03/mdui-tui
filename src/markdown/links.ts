import { dirname, extname, join, normalize, resolve } from "node:path";
import type { MarkdownFile } from "../fs/markdownFiles.js";

export type ParsedDocumentLink =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "internal"; readonly target: string };

export function firstDocumentLink(line: string): ParsedDocumentLink | undefined {
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/.exec(line);
  if (markdownLink?.[1] !== undefined) {
    const target = markdownLink[1].trim().replace(/^<|>$/g, "");
    const external = normalizeHttpUrl(target);
    return external === undefined ? { kind: "internal", target } : { kind: "external", url: external };
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
  return normalized === undefined ? undefined : { kind: "external", url: normalized };
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
