import { parseMarkdown } from "../markdown/parseMarkdown.js";
import { renderDocument, type RenderOptions } from "./renderDocument.js";

export function renderMarkdownToAnsi(markdown: string, options: RenderOptions): string {
  return `${renderDocument(parseMarkdown(markdown), options).join("\n")}\n`;
}
