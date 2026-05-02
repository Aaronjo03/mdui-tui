import type { VimMode } from "./finderKeys.js";

export interface FooterState {
  readonly vimMode?: VimMode;
  readonly sidebarVisible?: boolean;
  readonly cursorLine?: number;
  readonly cursorColumn?: number;
  readonly selectionAnchorLine?: number;
  readonly selectionAnchorColumn?: number;
  readonly searchQuery?: string;
  readonly searchMatch?: string;
  readonly countPrefix?: string;
  readonly documentStats?: string;
  readonly wrapEnabled?: boolean;
  readonly zoomLevel?: number;
}

export interface UrlInputState {
  readonly active: boolean;
  readonly query: string;
}

export interface DocumentSearchInputState {
  readonly active: boolean;
  readonly query: string;
  readonly match?: string;
}

export function footerText(notice: string, state: FooterState = {}): string {
  const vimMode = state.vimMode ?? "normal";
  const cursor = state.cursorLine !== undefined && state.cursorColumn !== undefined ? ` • ${state.cursorLine}:${state.cursorColumn}` : "";
  const stats = state.documentStats !== undefined ? ` • ${state.documentStats}` : "";
  const base = `${modeLabel(vimMode)}${cursor}${stats} • arrows/hjkl move • Tab/Esc sidebar • Ctrl-Shift-? help`;
  return notice.length > 0 ? `${base} • ${notice}` : base;
}

export function modeLabel(vimMode: VimMode): string {
  switch (vimMode) {
    case "normal":
      return "NORMAL";
    case "visual":
      return "VISUAL";
    case "visualBlock":
      return "V-BLOCK";
  }
}

export function headerText(
  query: string,
  shown: number,
  total: number,
  filterActive: boolean,
  vimMode: VimMode,
  sidebarVisible: boolean,
  urlInput: UrlInputState = { active: false, query: "" },
  documentSearch: DocumentSearchInputState = { active: false, query: "" },
): string {
  if (urlInput.active) {
    return `MDUI ${modeLabel(vimMode)} • URL: ${urlInput.query}_ • Enter opens remote Markdown • Esc cancels`;
  }
  if (documentSearch.active) {
    const match = documentSearch.match !== undefined ? ` [${documentSearch.match}]` : "";
    return `MDUI ${modeLabel(vimMode)} • search: /${documentSearch.query}_${match} • Enter confirms • Esc cancels`;
  }
  const filter = filterActive ? `filter: ${query}_` : "/ to filter";
  const sidebar = sidebarVisible ? "[Tab hide sidebar]" : "[Tab/Esc sidebar]";
  return `MDUI ${modeLabel(vimMode)} • ${sidebar} • ${filter} • Ctrl-u URL • ${shown}/${total} Markdown files`;
}

export function cliHelpText(): string {
  return `MDUI - terminal Markdown renderer powered by OpenTUI

Usage:
  mdui <file.md>   Render a Markdown file to stdout
  mdui <url.md>    Fetch and render a remote Markdown URL
  mdui             Open the interactive Markdown finder
  mdui help        Show this help

Finder keys:
  j/k or ↓/↑       Move file selection
  /                Type-to-filter mode
  Backspace        Remove filter character
  Enter            Open selected Markdown file
  q or Ctrl-C      Quit

Document keys:
  arrows or hjkl   Move the read-only cursor
  8j / 4k / 5l     Prefix motions with a count
  Ctrl-d           Scroll half a page down
  Ctrl-f / Ctrl-b  Scroll a page
  gg / G / 42G     Jump to top / bottom / line
  Tab              Toggle file sidebar
  Esc              Clear search, exit visual mode, or reopen sidebar
  /                Search document when sidebar is hidden; filter files when visible
  Enter            Confirm search (after /)
  n                Next search match
  p or N           Previous search match
  t                Toggle table of contents overlay
  Ctrl-o / Ctrl-i  Navigate back / forward through internal Markdown links
  v / Ctrl-v       Read-only visual / visual-block selection
  y                Yank visual / visual-block selection and clear highlight
  c                Copy highlighted text, or the document if nothing is highlighted
  o or Enter       Open selected text link, or link under cursor
  Ctrl-y           Copy current document as Slack mrkdwn
  Ctrl-p           Export current document to ~/Downloads/<filename>.pdf
  Ctrl-u           Paste/type a remote Markdown URL to open in the TUI
  Ctrl-/ or Ctrl-? Toggle in-app help
  Ctrl-Shift-?     Toggle in-app help in terminals that report Shift
  Ctrl-+ / Ctrl--  Zoom content wrapping in / out
  w                Toggle line wrapping
`;
}

export function helpPanelText(): string {
  return `MDUI Help

Info
  MDUI renders Markdown in your terminal with OpenTUI.
  It is read-only: use it for browsing, searching, copying, and exporting notes.

Finder
  j/k or ↓/↑       Move file selection
  /                Filter Markdown files
  Backspace        Remove filter character
  Enter            Open selected file
  q or Ctrl-C      Quit

Document
  arrows or hjkl   Move the read-only cursor
  8j / 4k / 5l     Prefix motions with a count
  Ctrl-d           Scroll half a page down
  Ctrl-f / Ctrl-b  Scroll a page
  gg / G / 42G     Jump to top / bottom / line
  Tab              Toggle file sidebar
  Esc              Clear search, exit visual mode, or reopen sidebar
  /                Search document fullscreen; filter files with sidebar open
  Enter            Confirm search (after /)
  n                Next search match
  p or N           Previous search match
  t                Toggle table of contents overlay
  Ctrl-o / Ctrl-i  Navigate back / forward through internal Markdown links
  v / Ctrl-v       Visual / visual-block selection
  y                Yank visual / visual-block selection and clear highlight
  c                Copy highlighted text, or the whole document
  o or Enter       Open selected text link, or link under cursor
  Ctrl-y           Copy Slack mrkdwn
  Ctrl-p           Export PDF to ~/Downloads
  Ctrl-u           Paste/type a remote Markdown URL to open in the TUI
  Ctrl-/ or Ctrl-? Toggle this panel
  Ctrl-Shift-?     Toggle this panel in terminals that report Shift
  Ctrl-+ / Ctrl--  Zoom content wrapping in / out
  w                Toggle line wrapping on or off
  j/k or ↓/↑       Scroll this panel when it does not fit
`;
}
