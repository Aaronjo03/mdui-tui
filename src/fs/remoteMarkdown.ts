import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { MarkdownFile } from "./markdownFiles.js";

export interface RemoteMarkdownDocument {
  readonly markdown: string;
  readonly sourceUrl: string;
  readonly file: MarkdownFile;
  readonly tempDirectory: string;
}

export interface FetchRemoteMarkdownOptions {
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
  readonly tempDirectory?: string;
  readonly now?: () => Date;
  readonly maxBytes?: number;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const defaultTimeoutMs = 10_000;
const defaultMaxBytes = 10 * 1024 * 1024;
const oscControlSequencePattern = new RegExp("\\u001B\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)", "g");
const csiControlSequencePattern = new RegExp("\\u001B\\[[0-?]*[ -/]*[@-~]", "g");
const c1OscControlSequencePattern = /\u009D[^\u009C]*(?:\u009C)/g;
const c1CsiControlSequencePattern = /\u009B[^\s\u009C]*/g;
const controlCharacterPattern = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g");
const htmlContentTypePattern = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const htmlDocumentPrefixPattern = /^\s*(?:<!doctype\s+html\b|<html\b)/i;

export function isRemoteMarkdownUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (parsed === undefined) {
    return false;
  }
  return isMarkdownUrlPath(parsed.pathname);
}

export function normalizeRemoteMarkdownUrl(value: string): string | undefined {
  const parsed = parseHttpUrl(value);
  return parsed !== undefined && isMarkdownUrlPath(parsed.pathname) ? parsed.toString() : undefined;
}

export function resolveRemoteMarkdownUrl(baseUrl: string, target: string): string | undefined {
  const cleanTarget = target.split("#", 1)[0]?.trim();
  if (cleanTarget === undefined || cleanTarget.length === 0) {
    return undefined;
  }
  try {
    const resolved = new URL(cleanTarget, baseUrl);
    return normalizeRemoteMarkdownUrl(resolved.toString());
  } catch {
    return undefined;
  }
}

export async function fetchRemoteMarkdown(url: string, options: FetchRemoteMarkdownOptions = {}): Promise<RemoteMarkdownDocument> {
  const sourceUrl = normalizeRemoteMarkdownUrl(url);
  if (sourceUrl === undefined) {
    throw new Error("Remote Markdown URL must use http(s) and end in a Markdown extension");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? defaultTimeoutMs);

  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const finalUrl = response.url.length > 0 ? response.url : sourceUrl;
    const normalizedFinalUrl = normalizeRemoteMarkdownUrl(finalUrl);
    if (normalizedFinalUrl === undefined) {
      throw new Error("Remote Markdown response redirected away from a Markdown URL");
    }
    rejectHtmlContentType(response);

    const maxBytes = options.maxBytes ?? defaultMaxBytes;
    rejectOversizedContentLength(response, maxBytes);
    const markdown = sanitizeTerminalControls(await readLimitedText(response, maxBytes, controller));
    rejectHtmlFallback(markdown);
    const parentDirectory = options.tempDirectory ?? tmpdir();
    await mkdir(parentDirectory, { recursive: true });
    const tempDirectory = await mkdtemp(join(parentDirectory, "mdui-remote-"));
    try {
      const name = remoteMarkdownFileName(normalizedFinalUrl);
      const absolutePath = join(tempDirectory, name);
      await writeFile(absolutePath, markdown, "utf8");

      const modifiedAt = options.now?.() ?? new Date();
      return {
        markdown,
        sourceUrl: normalizedFinalUrl,
        tempDirectory,
        file: {
          absolutePath,
          relativePath: remoteMarkdownRelativePath(normalizedFinalUrl),
          name,
          modifiedAt,
          sizeBytes: Buffer.byteLength(markdown, "utf8"),
        },
      };
    } catch (error) {
      await rm(tempDirectory, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Timed out fetching ${sourceUrl}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isMarkdownUrlPath(pathname: string): boolean {
  return new Set([".md", ".markdown", ".mdown", ".mkdn", ".mkd"]).has(extname(pathname).toLowerCase());
}

function rejectOversizedContentLength(response: Response, maxBytes: number): void {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) {
    return;
  }
  const parsed = Number.parseInt(contentLength, 10);
  if (Number.isFinite(parsed) && parsed > maxBytes) {
    throw new Error(`Remote Markdown is too large (${parsed} bytes; limit ${maxBytes} bytes)`);
  }
}

function rejectHtmlContentType(response: Response): void {
  const contentType = response.headers.get("content-type");
  if (contentType !== null && htmlContentTypePattern.test(contentType.trim())) {
    throw new Error("Remote Markdown response was HTML, not Markdown");
  }
}

function rejectHtmlFallback(markdown: string): void {
  if (htmlDocumentPrefixPattern.test(markdown)) {
    throw new Error("Remote Markdown response was HTML, not Markdown");
  }
}

async function readLimitedText(response: Response, maxBytes: number, controller: AbortController): Promise<string> {
  if (response.body === null) {
    throw new Error("Remote Markdown response did not include a body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel(`Remote Markdown exceeded ${maxBytes} bytes`);
        controller.abort();
        throw new Error(`Remote Markdown is too large (${totalBytes} bytes; limit ${maxBytes} bytes)`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(joinChunks(chunks, totalBytes));
}

function joinChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sanitizeTerminalControls(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .replace(oscControlSequencePattern, "")
    .replace(csiControlSequencePattern, "")
    .replace(c1OscControlSequencePattern, "")
    .replace(c1CsiControlSequencePattern, "")
    .replace(controlCharacterPattern, "");
}

function remoteMarkdownFileName(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  const name = basename(parsed.pathname);
  return name.length > 0 ? name : "remote.md";
}

function remoteMarkdownRelativePath(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  const path = parsed.pathname.replace(/^\/+/, "");
  return path.length > 0 ? `${parsed.hostname}/${path}` : `${parsed.hostname}/remote.md`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
