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
}

export function footerText(notice: string, state: FooterState = {}): string {
  const vimMode = state.vimMode ?? "normal";
  const sidebarVisible = state.sidebarVisible ?? true;
  const sidebarHelp = sidebarVisible ? "Tab hide sidebar" : "Tab/Esc sidebar";
  const cursor = state.cursorLine !== undefined && state.cursorColumn !== undefined ? ` • ${state.cursorLine}:${state.cursorColumn}` : "";
  const selection =
    state.selectionAnchorLine !== undefined && state.selectionAnchorColumn !== undefined && state.cursorLine !== undefined && state.cursorColumn !== undefined
      ? ` • ${state.selectionAnchorLine}:${state.selectionAnchorColumn}→${state.cursorLine}:${state.cursorColumn}`
      : "";
  const matchInfo = state.searchMatch !== undefined ? ` [${state.searchMatch}]` : "";
  const search = state.searchQuery !== undefined ? ` • /${state.searchQuery}_${matchInfo}` : matchInfo.length > 0 ? ` • search${matchInfo}` : "";
  const count = state.countPrefix !== undefined && state.countPrefix.length > 0 ? ` • count ${state.countPrefix}` : "";
  const stats = state.documentStats !== undefined ? ` • ${state.documentStats}` : "";
  const base = `${modeLabel(vimMode)}${cursor}${selection}${search}${count}${stats} • arrows/hjkl move • 8j counts • y yank visual • o open link • t ToC • ${sidebarHelp} • Ctrl-y Slack • Ctrl-p PDF • / search • Ctrl-/ help • q quit`;
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

export function cliHelpText(): string {
  return `MDUI - terminal Markdown renderer powered by OpenTUI

Usage:
  mdui <file.md>   Render a Markdown file to stdout
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
  Ctrl-d / Ctrl-u  Scroll half a page
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
  o or Enter       Open the first link on the current line
  Ctrl-y           Copy current document as Slack mrkdwn
  Ctrl-p           Export current document to ~/Downloads/<filename>.pdf
  Ctrl-/ or Ctrl-? Toggle in-app help
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
  Ctrl-d / Ctrl-u  Scroll half a page
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
  o or Enter       Open the first link on the current line
  Ctrl-y           Copy Slack mrkdwn
  Ctrl-p           Export PDF to ~/Downloads
  Ctrl-/ or Ctrl-? Close this panel
  j/k or ↓/↑       Scroll this panel when it does not fit
`;
}
