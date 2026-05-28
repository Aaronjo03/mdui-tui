import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { promisify } from "node:util";
import { marked, Renderer } from "marked";
import type { Token } from "marked";

const execFileAsync = promisify(execFile);

export interface PdfExportOptions {
  readonly outputDirectory?: string;
  readonly chromeExecutable?: string;
}

export async function exportMarkdownToPdf(
  markdown: string,
  sourcePath: string,
  options: PdfExportOptions = {},
): Promise<string> {
  const outputDirectory = options.outputDirectory ?? join(homedir(), "Downloads");
  const outputPath = join(outputDirectory, `${pdfBaseName(sourcePath)}.pdf`);
  const chromePath = options.chromeExecutable ?? (await findChromeExecutable());
  const documentUrl = await renderPdfDocumentUrl(markdown, pdfBaseName(sourcePath));

  await mkdir(outputDirectory, { recursive: true });
  await execFileAsync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-javascript",
    "--no-first-run",
    "--no-default-browser-check",
    "--print-to-pdf-no-header",
    `--print-to-pdf=${outputPath}`,
    documentUrl,
  ]);

  return outputPath;
}

async function renderPdfDocumentUrl(markdown: string, title: string): Promise<string> {
  const html = await renderPdfHtml(markdown, title);
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function renderPdfHtml(markdown: string, title: string): Promise<string> {
  const body = await marked.parse(markdown, { gfm: true, breaks: false, renderer: pdfRenderer() });
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 24mm 22mm; }
    :root { color: #111827; background: #ffffff; }
    body {
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-size: 12pt;
      line-height: 1.55;
      max-width: 760px;
      margin: 0 auto;
    }
    h1, h2, h3, h4 { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.2; color: #0f172a; }
    h1 { font-size: 28pt; margin: 0 0 18pt; border-bottom: 2px solid #dbeafe; padding-bottom: 8pt; }
    h2 { font-size: 19pt; margin: 24pt 0 10pt; }
    h3 { font-size: 15pt; margin: 18pt 0 8pt; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 12pt; }
    a { color: #2563eb; text-decoration: none; }
    code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 10pt; background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
    pre { background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 12pt; overflow-wrap: anywhere; white-space: pre-wrap; }
    pre code { background: transparent; color: inherit; padding: 0; }
    blockquote { border-left: 4px solid #93c5fd; color: #475569; padding-left: 12pt; font-style: italic; }
    table { border-collapse: collapse; width: 100%; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 10.5pt; page-break-inside: avoid; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; vertical-align: top; }
    th { background: #eff6ff; color: #0f172a; font-weight: 700; }
    tr:nth-child(even) td { background: #f8fafc; }
    hr { border: 0; border-top: 1px solid #cbd5e1; margin: 18pt 0; }
    .removed-image { color: #64748b; font-style: italic; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function pdfRenderer(): Renderer<string, string> {
  const renderer = new Renderer<string, string>();

  renderer.link = ({ href, title, tokens }) => {
    const text = escapeHtml(inlineTokenText(tokens));
    const safeHref = safeHttpUrl(href);
    if (safeHref === null) {
      return text;
    }

    const titleAttribute = title === null || title === undefined ? "" : ` title="${escapeHtml(title)}"`;
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute}>${text}</a>`;
  };

  renderer.image = ({ text }) => {
    const altText = text.trim();
    if (altText.length === 0) {
      return "";
    }
    return `<span class="removed-image">[image removed: ${escapeHtml(altText)}]</span>`;
  };

  renderer.html = ({ text }) => sanitizeRawHtml(text);

  return renderer;
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function inlineTokenText(tokens: readonly Token[]): string {
  return tokens.map(tokenText).join("");
}

function tokenText(token: Token): string {
  switch (token.type) {
    case "br":
      return "\n";
    case "codespan":
    case "escape":
    case "html":
    case "text":
      return token.text;
    case "del":
    case "em":
    case "link":
    case "strong":
      return token.tokens === undefined ? token.raw : inlineTokenText(token.tokens);
    case "image":
      return token.text;
    default:
      return "text" in token ? token.text : token.raw;
  }
}

async function findChromeExecutable(): Promise<string> {
  const candidates = chromeExecutableCandidates();
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("No Chrome-compatible browser found for PDF export.");
}

function chromeExecutableCandidates(): readonly string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ...pathCandidates(["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]),
      ];
    case "linux":
      return pathCandidates([
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
      ]);
    case "win32":
      return windowsChromeCandidates();
    default:
      return pathCandidates(["google-chrome", "chromium", "chromium-browser"]);
  }
}

function pathCandidates(names: readonly string[]): string[] {
  const paths = process.env.PATH?.split(delimiter).filter((entry) => entry.length > 0) ?? [];
  return paths.flatMap((directory) => names.map((name) => join(directory, name)));
}

function windowsChromeCandidates(): string[] {
  const bases = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
    (value): value is string => value !== undefined,
  );
  return bases.flatMap((base) => [
    join(base, "Google", "Chrome", "Application", "chrome.exe"),
    join(base, "Chromium", "Application", "chrome.exe"),
    join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
  ]);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pdfBaseName(sourcePath: string): string {
  const name = basename(sourcePath).replace(/\.[^.]+$/, "");
  const sanitized = name.replace(/[/:\\]/g, "-").trim();
  return sanitized.length > 0 ? sanitized : "markdown-export";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeRawHtml(value: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(safeRawHtmlTagPattern)) {
    const tag = match[0];
    parts.push(escapeHtml(value.slice(cursor, match.index)));
    parts.push(tag);
    cursor = match.index + tag.length;
  }
  parts.push(escapeHtml(value.slice(cursor)));
  return parts.join("");
}

const safeRawHtmlTagPattern = /<(?:br\s*\/|br|details|\/details|summary|\/summary)>/gi;
