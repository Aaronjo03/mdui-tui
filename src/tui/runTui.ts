import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import {
  BoxRenderable,
  createCliRenderer,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  SyntaxStyle,
  TextRenderable,
  type KeyEvent,
  type SelectOption,
} from "@opentui/core";
import { exportMarkdownToPdf } from "../export/pdf.js";
import { markdownToSlackMrkdwn } from "../export/slack.js";
import { discoverMarkdownFiles, type MarkdownFile } from "../fs/markdownFiles.js";
import { filterFiles, type RankedFile } from "../finder/filterFiles.js";
import { renderMarkdownToAnsi } from "../render/markdownToAnsi.js";
import { copyToClipboard } from "./clipboard.js";
import { decideFinderKey, type VimMode } from "./finderKeys.js";
import { footerText, helpPanelText, modeLabel } from "./text.js";

export interface TuiOptions {
  readonly rootDirectory: string;
}

type FinderRoute = { readonly type: "finder" };
type DocumentRoute = { readonly type: "document"; readonly file: MarkdownFile };
type Route = FinderRoute | DocumentRoute;

interface DocumentPosition {
  readonly cursorLine: number;
  readonly cursorColumn: number;
  readonly scrollTop: number;
}

interface TuiState {
  route: Route;
  filterActive: boolean;
  query: string;
  ranked: readonly RankedFile[];
  documentText: string;
  markdownSource: string;
  documentLines: readonly string[];
  documentSearchActive: boolean;
  documentSearchQuery: string;
  cursorLine: number;
  cursorColumn: number;
  cursorViewportRow: number;
  visualAnchorLine: number;
  visualAnchorColumn: number;
  goPrefixActive: boolean;
  countPrefix: string;
  helpVisible: boolean;
  notice: string;
  sidebarVisible: boolean;
  vimMode: VimMode;
}

export async function runTui(options: TuiOptions): Promise<void> {
  const files = await discoverMarkdownFiles({ rootDirectory: options.rootDirectory });
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 60,
    useMouse: true,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    externalOutputMode: "passthrough",
    screenMode: "alternate-screen",
    consoleMode: "disabled",
    clearOnShutdown: true,
  });
  renderer.setTerminalTitle("MDUI");
  let exiting = false;
  const exit = (): void => {
    if (exiting) {
      return;
    }
    exiting = true;
    if (noticeTimer !== undefined) {
      clearTimeout(noticeTimer);
    }
    renderer.setTerminalTitle("");
    renderer.destroy();
  };
  const handleHangup = (): void => {
    exit();
  };
  process.once("SIGHUP", handleHangup);

  const state: TuiState = {
    route: { type: "finder" },
    filterActive: false,
    query: "",
    ranked: filterFiles(files, ""),
    documentText: "",
    markdownSource: "",
    documentLines: [],
    documentSearchActive: false,
    documentSearchQuery: "",
    cursorLine: 0,
    cursorColumn: 0,
    cursorViewportRow: 0,
    visualAnchorLine: 0,
    visualAnchorColumn: 0,
    goPrefixActive: false,
    countPrefix: "",
    helpVisible: false,
    notice: "",
    sidebarVisible: true,
    vimMode: "normal",
  };
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeVersion = 0;
  const documentPositions = new Map<string, DocumentPosition>();

  renderer._internalKeyInput.onInternal("keypress", (key: KeyEvent) => {
    if (state.route.type === "document" && !state.helpVisible && !state.documentSearchActive && isCopyKey(key)) {
      copySelection({ fallbackToDocument: true });
      key.preventDefault();
      key.stopPropagation();
    }
  });

  const root = new BoxRenderable(renderer, {
    id: "mdui-root",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    gap: 1,
    onMouseUp: () => {
      if (state.helpVisible) {
        return;
      }
      copySelection({ fallbackToDocument: false });
    },
  });
  renderer.root.add(root);

  const noticeOverlay = new TextRenderable(renderer, {
    id: "mdui-notice-overlay",
    content: "",
    position: "absolute",
    top: 1,
    right: 2,
    zIndex: 100,
    fg: "#0F172A",
    bg: "#7DD3FC",
    visible: false,
  });
  renderer.root.add(noticeOverlay);

  const helpPanel = new BoxRenderable(renderer, {
    id: "mdui-help-panel",
    position: "absolute",
    top: 2,
    left: 4,
    width: 78,
    height: 32,
    zIndex: 90,
    border: true,
    borderStyle: "rounded",
    borderColor: "#7DD3FC",
    backgroundColor: "#111827",
    title: " Help ",
    padding: 1,
    visible: false,
  });
  renderer.root.add(helpPanel);

  const helpPanelScroll = new ScrollBoxRenderable(renderer, {
    id: "mdui-help-panel-scroll",
    width: "100%",
    height: "100%",
    scrollY: true,
    scrollX: false,
    viewportCulling: false,
  });
  helpPanel.add(helpPanelScroll);

  const helpPanelBody = new TextRenderable(renderer, {
    id: "mdui-help-panel-body",
    content: helpPanelText(),
    fg: "#E5E7EB",
    bg: "#111827",
    width: "100%",
  });
  helpPanelScroll.add(helpPanelBody);

  const header = new TextRenderable(renderer, {
    id: "mdui-header",
    content: headerText(state.query, state.ranked.length, files.length, state.filterActive, state.vimMode, state.sidebarVisible),
    fg: "#7DD3FC",
  });
  root.add(header);

  const body = new BoxRenderable(renderer, {
    id: "mdui-body",
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
    gap: 1,
  });
  root.add(body);

  const finderPanel = new BoxRenderable(renderer, {
    id: "mdui-finder-panel",
    width: 42,
    minWidth: 32,
    maxWidth: 56,
    flexShrink: 0,
    border: true,
    borderStyle: "rounded",
    borderColor: "#64748B",
    backgroundColor: "#1E2233",
    title: " Markdown files ",
    padding: 1,
  });
  body.add(finderPanel);

  const finder = new SelectRenderable(renderer, {
    id: "mdui-finder",
    options: rankedToOptions(state.ranked),
    selectedIndex: 0,
    flexGrow: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#1E2233",
    focusedBackgroundColor: "#242A3A",
    textColor: "#E5E7EB",
    showDescription: true,
    showScrollIndicator: true,
    wrapSelection: true,
    selectedBackgroundColor: "#334155",
    selectedTextColor: "#FFFFFF",
    focusedTextColor: "#FFFFFF",
    descriptionColor: "#94A3B8",
    selectedDescriptionColor: "#CBD5E1",
  });
  finderPanel.add(finder);

  const viewer = new ScrollBoxRenderable(renderer, {
    id: "mdui-viewer-scroll",
    flexGrow: 2,
    width: "100%",
    scrollY: true,
    scrollX: false,
    border: true,
    borderStyle: "rounded",
    title: " Preview ",
    padding: 1,
    viewportCulling: true,
    onKeyDown: (key: KeyEvent) => {
      if (state.route.type === "document" && !state.helpVisible && !state.documentSearchActive && isCopyKey(key)) {
        copySelection({ fallbackToDocument: true });
        key.preventDefault();
        key.stopPropagation();
      }
    },
  });
  body.add(viewer);

  const markdownStyle = createMarkdownSyntaxStyle();
  const viewerContent = new BoxRenderable(renderer, {
    id: "mdui-viewer-content",
    flexDirection: "row",
    width: "100%",
    alignItems: "flex-start",
  });
  viewer.add(viewerContent);

  const viewerMarkdown = new MarkdownRenderable(renderer, {
    id: "mdui-viewer-markdown",
    content: files.length === 0 ? "No Markdown files found." : "Select a Markdown file and press Enter.",
    syntaxStyle: markdownStyle,
    conceal: true,
    fg: "#CBD5E1",
    width: "100%",
    tableOptions: {
      style: "grid",
      widthMode: "full",
      wrapMode: "word",
      cellPadding: 1,
      borders: true,
      outerBorder: true,
      borderStyle: "single",
      borderColor: "#8B8FA3",
      selectable: true,
    },
  });
  viewerMarkdown.selectable = true;

  const lineNumbers = new TextRenderable(renderer, {
    id: "mdui-line-numbers",
    content: "",
    width: 5,
    fg: "#7DD3FC",
    flexShrink: 0,
    visible: false,
  });
  lineNumbers.selectable = false;
  viewerContent.add(lineNumbers);
  viewerContent.add(viewerMarkdown);

  const footer = new TextRenderable(renderer, {
    id: "mdui-footer",
    content: footerText(state.notice, footerState()),
    fg: "#94A3B8",
  });
  root.add(footer);

  finder.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    void openSelected().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      viewer.title = " Error ";
      viewerMarkdown.content = `Unable to open file: ${message}`;
      viewer.focus();
    });
  });

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "c" && renderer.getSelection()?.getSelectedText()) {
      copySelection({ fallbackToDocument: false });
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (state.helpVisible && isHelpCloseKey(key)) {
      state.helpVisible = false;
      refreshChrome();
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (state.helpVisible && isHelpScrollKey(key)) {
      scrollHelpPanel(key);
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (state.helpVisible && !(key.ctrl && key.name === "c")) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    const resetGoPrefix = state.goPrefixActive && !(state.route.type === "document" && key.name === "g" && !key.ctrl && !key.meta);
    if (resetGoPrefix) {
      state.goPrefixActive = false;
    }
    const decision = decideFinderKey(
      {
        routeType: state.route.type,
        filterActive: state.filterActive,
        query: state.documentSearchActive ? state.documentSearchQuery : state.query,
        sidebarVisible: state.sidebarVisible,
        vimMode: state.vimMode,
        documentSearchActive: state.documentSearchActive,
        goPrefixActive: state.goPrefixActive,
        countPrefix: state.countPrefix,
      },
      key,
    );
    switch (decision.kind) {
      case "exit":
        exit();
        return;
      case "backToFinder":
        rememberCurrentDocumentPosition();
        state.route = { type: "finder" };
        state.filterActive = false;
        state.documentText = "";
        state.markdownSource = "";
        state.documentLines = [];
        state.documentSearchActive = false;
        state.documentSearchQuery = "";
        state.cursorLine = 0;
        state.cursorColumn = 0;
        state.cursorViewportRow = 0;
        state.visualAnchorLine = 0;
        state.visualAnchorColumn = 0;
        state.goPrefixActive = false;
        state.countPrefix = "";
        state.sidebarVisible = true;
        state.vimMode = "normal";
        renderer.setTerminalTitle("MDUI");
        viewer.title = " Preview ";
        viewerMarkdown.content = "Select a Markdown file and press Enter.";
        refreshChrome();
        applySidebarVisibility();
        finder.focus();
        key.preventDefault();
        return;
      case "showSidebar":
        rememberCurrentDocumentPosition();
        state.sidebarVisible = true;
        state.documentSearchActive = false;
        state.documentSearchQuery = "";
        refreshChrome();
        applySidebarVisibility();
        updateDocumentCursor();
        finder.focus();
        key.preventDefault();
        return;
      case "toggleSidebar":
        rememberCurrentDocumentPosition();
        state.sidebarVisible = !state.sidebarVisible;
        refreshChrome();
        applySidebarVisibility();
        if (state.sidebarVisible) {
          state.documentSearchActive = false;
          state.documentSearchQuery = "";
          finder.focus();
        } else {
          viewer.focus();
        }
        updateDocumentCursor();
        key.preventDefault();
        return;
      case "enterVisualMode":
        state.goPrefixActive = false;
        state.countPrefix = "";
        state.vimMode = "visual";
        setVisualAnchor();
        updateVisualSelection();
        refreshChrome();
        key.preventDefault();
        return;
      case "enterVisualBlockMode":
        state.goPrefixActive = false;
        state.countPrefix = "";
        state.vimMode = "visualBlock";
        setVisualAnchor();
        updateVisualSelection();
        refreshChrome();
        key.preventDefault();
        return;
      case "exitVisualMode":
        state.vimMode = "normal";
        renderer.clearSelection();
        refreshChrome();
        key.preventDefault();
        return;
      case "copySelection":
        copySelection({ fallbackToDocument: true });
        state.countPrefix = "";
        if (state.vimMode !== "normal") {
          state.vimMode = "normal";
          renderer.clearSelection();
          refreshChrome();
        }
        key.preventDefault();
        key.stopPropagation();
        return;
      case "yankAndExitVisual":
        copySelection({ fallbackToDocument: false });
        state.countPrefix = "";
        state.vimMode = "normal";
        renderer.clearSelection();
        refreshChrome();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "copySlack":
        state.countPrefix = "";
        copyCurrentDocumentAsSlack();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "exportPdf":
        state.countPrefix = "";
        void exportCurrentDocumentPdf().catch((error: unknown) => {
          showNotice(error instanceof Error ? `PDF export failed: ${error.message}` : "PDF export failed");
        });
        key.preventDefault();
        key.stopPropagation();
        return;
      case "openLink":
        openCurrentLineLink();
        resetCountPrefix();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "toggleHelp":
        state.helpVisible = !state.helpVisible;
        state.goPrefixActive = false;
        state.countPrefix = "";
        if (state.helpVisible) {
          state.documentSearchActive = false;
          state.documentSearchQuery = "";
          helpPanelScroll.scrollTop = 0;
          renderer.clearSelection();
        }
        refreshChrome();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "startDocumentSearch":
        state.countPrefix = "";
        state.documentSearchActive = true;
        state.documentSearchQuery = "";
        renderer.clearSelection();
        refreshChrome();
        key.preventDefault();
        return;
      case "updateDocumentSearch":
        state.documentSearchQuery = decision.query;
        moveCursorToSearchMatch();
        refreshChrome();
        updateDocumentCursor();
        key.preventDefault();
        return;
      case "clearDocumentSearch":
        state.countPrefix = "";
        state.documentSearchActive = false;
        state.documentSearchQuery = "";
        renderer.clearSelection();
        refreshChrome();
        updateDocumentCursor();
        key.preventDefault();
        return;
      case "moveCursorLeft":
        state.goPrefixActive = false;
        moveDocumentCursor(0, -repeatCount());
        resetCountPrefix();
        key.preventDefault();
        return;
      case "moveCursorRight":
        state.goPrefixActive = false;
        moveDocumentCursor(0, repeatCount());
        resetCountPrefix();
        key.preventDefault();
        return;
      case "moveCursorUp":
        state.goPrefixActive = false;
        moveDocumentCursor(-repeatCount(), 0);
        resetCountPrefix();
        key.preventDefault();
        return;
      case "moveCursorDown":
        state.goPrefixActive = false;
        moveDocumentCursor(repeatCount(), 0);
        resetCountPrefix();
        key.preventDefault();
        return;
      case "moveCursorLineStart":
        state.goPrefixActive = false;
        state.cursorColumn = 0;
        updateDocumentCursor();
        updateVisualSelection();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "accumulateCount":
        state.countPrefix = `${state.countPrefix}${decision.digit}`;
        refreshChrome();
        key.preventDefault();
        return;
      case "startGoPrefix":
        state.goPrefixActive = true;
        refreshChrome();
        key.preventDefault();
        return;
      case "scrollHalfPageDown":
        viewer.scrollBy(0.5, "viewport");
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "scrollHalfPageUp":
        viewer.scrollBy(-0.5, "viewport");
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "scrollPageDown":
        viewer.scrollBy(1, "viewport");
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "scrollPageUp":
        viewer.scrollBy(-1, "viewport");
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "scrollToTop":
        state.goPrefixActive = false;
        state.countPrefix = "";
        viewer.scrollTop = 0;
        state.cursorLine = 0;
        state.cursorColumn = 0;
        state.cursorViewportRow = 0;
        refreshChrome();
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "scrollToBottom":
        state.countPrefix = "";
        viewer.scrollTop = viewer.scrollHeight;
        state.cursorLine = Math.max(0, state.documentLines.length - 1);
        state.cursorColumn = 0;
        state.cursorViewportRow = clamp(state.cursorLine - viewer.scrollTop, 0, visibleDocumentRows() - 1);
        refreshChrome();
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "clearFilter":
        state.countPrefix = "";
        state.filterActive = false;
        state.query = "";
        refreshFinder();
        key.preventDefault();
        return;
      case "startFilter":
        state.route = { type: "finder" };
        state.filterActive = true;
        state.sidebarVisible = true;
        state.vimMode = "normal";
        state.countPrefix = "";
        state.documentSearchActive = false;
        state.documentSearchQuery = "";
        refreshChrome();
        applySidebarVisibility();
        updateDocumentCursor();
        finder.focus();
        key.preventDefault();
        return;
      case "updateFilter":
        state.countPrefix = "";
        state.query = decision.query;
        refreshFinder();
        key.preventDefault();
        return;
      case "passThrough":
        if (state.countPrefix.length > 0) {
          state.countPrefix = "";
          refreshChrome();
        }
        return;
    }
  });

  finder.focus();
  renderer.start();
  renderer.on("destroy", () => {
    process.off("SIGHUP", handleHangup);
  });

  async function openSelected(): Promise<void> {
    const selected = selectedRankedFile(state.ranked, finder.getSelectedIndex());
    if (selected === undefined) {
      return;
    }
    rememberCurrentDocumentPosition();
    state.route = { type: "document", file: selected.file };
    state.filterActive = false;
    state.sidebarVisible = false;
    state.vimMode = "normal";
    state.documentSearchActive = false;
    state.documentSearchQuery = "";
    state.visualAnchorLine = 0;
    state.visualAnchorColumn = 0;
    state.goPrefixActive = false;
    state.countPrefix = "";
    renderer.clearSelection();
    const markdown = await readFile(selected.file.absolutePath, "utf8");
    const width = Math.max(40, renderer.terminalWidth - 8);
    const rendered = renderMarkdownToAnsi(markdown, { width, color: false });
    viewer.title = ` ${basename(selected.file.relativePath)} `;
    renderer.setTerminalTitle(`MDUI - ${selected.file.relativePath}`);
    state.documentText = rendered;
    state.markdownSource = markdown;
    state.documentLines = rendered.split("\n");
    restoreDocumentPosition(selected.file.absolutePath);
    viewerMarkdown.content = markdown;
    refreshChrome();
    applySidebarVisibility();
    await placeDocumentCursorAfterLayout();
    viewer.focus();
  }

  async function placeDocumentCursorAfterLayout(): Promise<void> {
    renderer.requestRender();
    await renderer.idle();
    updateDocumentCursor();
  }

  function refreshFinder(): void {
    state.ranked = filterFiles(files, state.query);
    finder.options = rankedToOptions(state.ranked);
    finder.selectedIndex = 0;
    refreshChrome();
  }

  function refreshChrome(): void {
    header.content = headerText(state.query, state.ranked.length, files.length, state.filterActive, state.vimMode, state.sidebarVisible);
    footer.content = footerText(state.notice, footerState());
    lineNumbers.visible = state.route.type === "document";
    lineNumbers.content = state.route.type === "document" ? lineNumberText(state.documentLines.length) : "";
    helpPanel.visible = state.helpVisible;
    layoutHelpPanel();
  }

  function repeatCount(): number {
    const parsed = Number.parseInt(state.countPrefix, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function resetCountPrefix(): void {
    state.countPrefix = "";
    refreshChrome();
  }

  function lineNumberText(lineCount: number): string {
    const width = Math.max(3, String(Math.max(1, lineCount)).length);
    return Array.from({ length: Math.max(1, lineCount) }, (_, index) => `${String(index).padStart(width, " ")} `).join("\n");
  }

  function layoutHelpPanel(): void {
    const panelWidth = clamp(78, 44, Math.max(44, renderer.terminalWidth - 4));
    const panelHeight = clamp(32, 18, Math.max(18, renderer.terminalHeight - 4));
    helpPanel.width = panelWidth;
    helpPanel.height = panelHeight;
    helpPanelScroll.height = Math.max(1, panelHeight - 4);
    helpPanel.left = Math.max(1, Math.floor((renderer.terminalWidth - panelWidth) / 2));
    helpPanel.top = Math.max(1, Math.floor((renderer.terminalHeight - panelHeight) / 2));
  }

  function scrollHelpPanel(key: KeyEvent): void {
    if (key.name === "up" || key.name === "k") {
      helpPanelScroll.scrollBy(-1, "step");
      return;
    }
    if (key.name === "down" || key.name === "j") {
      helpPanelScroll.scrollBy(1, "step");
      return;
    }
    if (key.ctrl && key.name === "u") {
      helpPanelScroll.scrollBy(-0.5, "viewport");
      return;
    }
    helpPanelScroll.scrollBy(0.5, "viewport");
  }

  function rememberCurrentDocumentPosition(): void {
    if (state.route.type !== "document") {
      return;
    }
    documentPositions.set(state.route.file.absolutePath, {
      cursorLine: state.cursorLine,
      cursorColumn: 0,
      scrollTop: viewer.scrollTop,
    });
  }

  function restoreDocumentPosition(absolutePath: string): void {
    const savedPosition = documentPositions.get(absolutePath);
    if (savedPosition === undefined) {
      state.cursorLine = 0;
      state.cursorColumn = 0;
      state.cursorViewportRow = 0;
      viewer.scrollTop = 0;
      return;
    }
    state.cursorLine = clamp(savedPosition.cursorLine, 0, Math.max(0, state.documentLines.length - 1));
    state.cursorColumn = 0;
    viewer.scrollTop = clamp(savedPosition.scrollTop, 0, Math.max(0, state.documentLines.length - 1));
    state.cursorViewportRow = clamp(state.cursorLine - viewer.scrollTop, 0, visibleDocumentRows() - 1);
  }

  function footerState(): {
    readonly vimMode: VimMode;
    readonly sidebarVisible: boolean;
    readonly cursorLine?: number;
    readonly cursorColumn?: number;
    readonly selectionAnchorLine?: number;
    readonly selectionAnchorColumn?: number;
    readonly searchQuery?: string;
    readonly countPrefix?: string;
  } {
    const footer = {
      vimMode: state.vimMode,
      sidebarVisible: state.sidebarVisible,
    };
    return {
      ...footer,
      ...(state.route.type === "document" ? { cursorLine: state.cursorLine, cursorColumn: state.cursorColumn } : {}),
      ...(state.vimMode !== "normal" ? { selectionAnchorLine: state.visualAnchorLine, selectionAnchorColumn: state.visualAnchorColumn } : {}),
      ...(state.documentSearchActive ? { searchQuery: state.documentSearchQuery } : {}),
      ...(state.countPrefix.length > 0 ? { countPrefix: state.countPrefix } : {}),
    };
  }

  function applySidebarVisibility(): void {
    finderPanel.visible = state.sidebarVisible;
    finderPanel.width = state.sidebarVisible ? 42 : 0;
    finderPanel.minWidth = state.sidebarVisible ? 32 : 0;
    finderPanel.maxWidth = state.sidebarVisible ? 56 : 0;
    body.gap = state.sidebarVisible ? 1 : 0;
    renderer.requestRender();
  }

  function moveDocumentCursor(lineDelta: number, columnDelta: number): void {
    if (state.documentLines.length === 0) {
      return;
    }
    syncCursorToViewport();
    const nextLine = clamp(state.cursorLine + lineDelta, 0, state.documentLines.length - 1);
    const nextColumn = lineDelta === 0 ? clamp(state.cursorColumn + columnDelta, 0, lineLength(nextLine)) : 0;
    state.cursorLine = nextLine;
    state.cursorColumn = nextColumn;
    ensureCursorVisible();
    refreshChrome();
    updateDocumentCursor();
    updateVisualSelection();
    rememberCurrentDocumentPosition();
  }

  function moveCursorToSearchMatch(): void {
    const query = state.documentSearchQuery.toLowerCase();
    if (query.length === 0) {
      renderer.clearSelection();
      return;
    }
    for (const [lineIndex, line] of state.documentLines.entries()) {
      const columnIndex = line.toLowerCase().indexOf(query);
      if (columnIndex >= 0) {
        state.cursorLine = lineIndex;
        state.cursorColumn = columnIndex;
        ensureCursorVisible();
        updateSearchSelection();
        rememberCurrentDocumentPosition();
        return;
      }
    }
    renderer.clearSelection();
  }

  function ensureCursorVisible(): void {
    const visibleRows = visibleDocumentRows();
    if (state.cursorLine < viewer.scrollTop) {
      viewer.scrollTop = state.cursorLine;
    }
    if (state.cursorLine >= viewer.scrollTop + visibleRows) {
      viewer.scrollTop = state.cursorLine - visibleRows + 1;
    }
  }

  function updateDocumentCursor(): void {
    if (state.route.type !== "document" || state.sidebarVisible || state.documentLines.length === 0) {
      renderer.setCursorPosition(0, 0, false);
      return;
    }
    const row = state.cursorLine - viewer.scrollTop;
    const visibleRows = visibleDocumentRows();
    if (row < 0 || row >= visibleRows) {
      renderer.setCursorPosition(0, 0, false);
      return;
    }
    state.cursorViewportRow = row;
    const x = viewerMarkdown.screenX + state.cursorColumn;
    const y = viewerMarkdown.screenY + row;
    renderer.setCursorStyle({ style: state.vimMode === "normal" ? "block" : "underline", blinking: true });
    renderer.setCursorPosition(x, y, true);
  }

  function syncCursorToViewport(): void {
    const firstVisibleLine = clamp(viewer.scrollTop, 0, Math.max(0, state.documentLines.length - 1));
    const lastVisibleLine = clamp(firstVisibleLine + visibleDocumentRows() - 1, 0, Math.max(0, state.documentLines.length - 1));
    if (state.cursorLine < firstVisibleLine || state.cursorLine > lastVisibleLine) {
      state.cursorLine = clamp(firstVisibleLine + state.cursorViewportRow, firstVisibleLine, lastVisibleLine);
      state.cursorColumn = 0;
    }
  }

  function setVisualAnchor(): void {
    state.visualAnchorLine = state.cursorLine;
    state.visualAnchorColumn = state.cursorColumn;
  }

  function updateVisualSelection(): void {
    if (state.vimMode === "normal" || state.route.type !== "document" || state.sidebarVisible) {
      return;
    }
    const anchor = cursorScreenPosition(state.visualAnchorLine, state.visualAnchorColumn);
    const cursor = cursorScreenPosition(state.cursorLine, state.cursorColumn);
    if (anchor === undefined || cursor === undefined) {
      return;
    }
    renderer.startSelection(viewerMarkdown, anchor.x, anchor.y);
    renderer.updateSelection(viewerMarkdown, cursor.x, cursor.y, { finishDragging: false });
  }

  function updateSearchSelection(): void {
    if (!state.documentSearchActive || state.documentSearchQuery.length === 0 || state.sidebarVisible) {
      return;
    }
    const start = cursorScreenPosition(state.cursorLine, state.cursorColumn);
    const end = cursorScreenPosition(state.cursorLine, state.cursorColumn + Math.max(1, state.documentSearchQuery.length));
    if (start === undefined || end === undefined) {
      return;
    }
    renderer.startSelection(viewerMarkdown, start.x, start.y);
    renderer.updateSelection(viewerMarkdown, end.x, end.y, { finishDragging: false });
  }

  function cursorScreenPosition(line: number, column: number): { readonly x: number; readonly y: number } | undefined {
    const row = line - viewer.scrollTop;
    if (row < 0 || row >= visibleDocumentRows()) {
      return undefined;
    }
    return { x: viewerMarkdown.screenX + column, y: viewerMarkdown.screenY + row };
  }

  function visibleDocumentRows(): number {
    return Math.max(1, viewer.height - 3);
  }

  function lineLength(lineIndex: number): number {
    return state.documentLines[lineIndex]?.length ?? 0;
  }

  function copySelection(options: { readonly fallbackToDocument: boolean }): boolean {
    const selection = renderer.getSelection();
    const selectedText = selection?.getSelectedText().trim();
    const textToCopy = selectedText !== undefined && selectedText.length > 0 ? selectedText : options.fallbackToDocument ? state.documentText.trim() : "";
    if (textToCopy.length === 0) {
      if (options.fallbackToDocument) {
        showNotice("Nothing to copy");
      }
      return false;
    }
    const copied = copyTextToClipboard(textToCopy);
    showNotice(copied ? (selectedText !== undefined && selectedText.length > 0 ? "Copied highlighted text" : "Copied document") : "Clipboard copy failed");
    try {
      renderer.clearSelection();
    } catch (error) {
      showNotice(error instanceof Error ? `Selection clear failed: ${error.message}` : "Selection clear failed");
    }
    return copied;
  }

  function copyCurrentDocumentAsSlack(): void {
    if (state.route.type !== "document" || state.markdownSource.trim().length === 0) {
      showNotice("Nothing to copy for Slack");
      return;
    }
    const slackText = markdownToSlackMrkdwn(state.markdownSource);
    const copied = copyTextToClipboard(slackText);
    showNotice(copied ? "Copied Slack mrkdwn" : "Slack clipboard copy failed");
  }

  function openCurrentLineLink(): void {
    if (state.route.type !== "document") {
      return;
    }
    const renderedLine = state.documentLines[state.cursorLine] ?? "";
    const sourceLine = state.markdownSource.split("\n")[state.cursorLine] ?? "";
    const url = firstUrlInText(renderedLine) ?? firstMarkdownLinkUrl(sourceLine) ?? firstUrlInText(sourceLine);
    if (url === undefined) {
      showNotice("No link on current line");
      return;
    }
    openUrlInBrowser(url);
  }

  function openUrlInBrowser(url: string): void {
    const command = browserOpenCommand(url);
    if (command === undefined) {
      showNotice("Opening links is not supported on this platform");
      return;
    }
    try {
      const child = spawn(command.executable, command.args, { detached: true, stdio: "ignore" });
      child.on("error", (error: Error) => {
        showNotice(`Open link failed: ${error.message}`);
      });
      child.unref();
      showNotice(`Opened ${url}`);
    } catch (error) {
      showNotice(error instanceof Error ? `Open link failed: ${error.message}` : "Open link failed");
    }
  }

  async function exportCurrentDocumentPdf(): Promise<void> {
    if (state.route.type !== "document" || state.markdownSource.trim().length === 0) {
      showNotice("Nothing to export");
      return;
    }
    showNotice("Exporting PDF…");
    const outputPath = await exportMarkdownToPdf(state.markdownSource, state.route.file.absolutePath);
    showNotice(`Saved ${basename(outputPath)}`);
  }

  function copyTextToClipboard(text: string): boolean {
    let copied = false;
    try {
      copied = renderer.copyToClipboardOSC52(text);
    } catch {
      copied = false;
    }
    return copied || copyToClipboard(text);
  }

  function showNotice(message: string): void {
    noticeVersion += 1;
    const currentNoticeVersion = noticeVersion;
    if (noticeTimer !== undefined) {
      clearTimeout(noticeTimer);
    }
    state.notice = message;
    noticeOverlay.content = ` ${message} `;
    noticeOverlay.visible = true;
    refreshChrome();
    renderer.requestRender();
    noticeTimer = setTimeout(() => {
      if (noticeVersion === currentNoticeVersion) {
        state.notice = "";
        noticeOverlay.visible = false;
        noticeOverlay.content = "";
        refreshChrome();
        renderer.requestRender();
      }
    }, 2500);
  }
}

function isCopyKey(key: KeyEvent): boolean {
  if (key.ctrl || key.meta) {
    return false;
  }
  return key.name.toLowerCase() === "c" || isCopyInputSequence(key.sequence) || isCopyInputSequence(key.raw);
}

function isHelpCloseKey(key: KeyEvent): boolean {
  return key.name === "escape" || (!key.ctrl && !key.meta && key.name === "q") || isHelpToggleInput(key);
}

function isHelpScrollKey(key: KeyEvent): boolean {
  return key.name === "up" || key.name === "down" || key.name === "j" || key.name === "k" || (key.ctrl && (key.name === "d" || key.name === "u"));
}

function isHelpToggleInput(key: KeyEvent): boolean {
  return key.ctrl && (key.name === "?" || key.name === "/" || key.sequence === "\u001F" || key.raw === "\u001F");
}

function firstMarkdownLinkUrl(text: string): string | undefined {
  const match = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/.exec(text);
  return normalizeHttpUrl(match?.[1]);
}

function firstUrlInText(text: string): string | undefined {
  const match = /(?:https?:\/\/[^\s)]+|www\.[^\s)]+)/.exec(text);
  if (match === null) {
    return undefined;
  }
  const url = match[0].replace(/[.,;:!?]+$/, "");
  return normalizeHttpUrl(url.startsWith("www.") ? `https://${url}` : url);
}

function browserOpenCommand(url: string): { readonly executable: string; readonly args: readonly string[] } | undefined {
  const normalizedUrl = normalizeHttpUrl(url);
  if (normalizedUrl === undefined) {
    return undefined;
  }
  switch (process.platform) {
    case "darwin":
      return { executable: "open", args: [normalizedUrl] };
    case "win32":
      return { executable: "rundll32.exe", args: ["url.dll,FileProtocolHandler", normalizedUrl] };
    case "linux":
      return { executable: "xdg-open", args: [normalizedUrl] };
    default:
      return undefined;
  }
}

function normalizeHttpUrl(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isCopyInputSequence(sequence: string): boolean {
  return sequence === "c" || sequence === "\u001B[99u" || (sequence.startsWith("\u001B[99;") && sequence.endsWith("u"));
}

function createMarkdownSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: "#CBD5E1" },
    conceal: { fg: "#8B8FA3" },
    markup: { fg: "#CBD5E1" },
    "markup.heading": { fg: "#C4A7E7", bold: true },
    "markup.strong": { fg: "#C4A7E7", bold: true },
    "markup.italic": { fg: "#F6C177", italic: true },
    "markup.raw": { fg: "#9ECE6A" },
    "markup.link": { fg: "#8B8FA3" },
    "markup.link.label": { fg: "#7DD3FC", underline: true },
    "markup.link.url": { fg: "#9ECE6A" },
    "markup.list": { fg: "#7DD3FC" },
    "markup.quote": { fg: "#F6C177", italic: true },
    string: { fg: "#9ECE6A" },
    number: { fg: "#9ECE6A" },
    keyword: { fg: "#C4A7E7", bold: true },
    function: { fg: "#7DD3FC" },
  });
}

function rankedToOptions(ranked: readonly RankedFile[]): SelectOption[] {
  return ranked.map(({ file }) => ({
    name: file.name,
    description: `${file.relativePath} · ${formatSize(file.sizeBytes)}`,
  }));
}

function selectedRankedFile(ranked: readonly RankedFile[], index: number): RankedFile | undefined {
  return index >= 0 ? ranked[index] : undefined;
}

function headerText(query: string, shown: number, total: number, filterActive: boolean, vimMode: VimMode, sidebarVisible: boolean): string {
  const filter = filterActive ? ` filter: ${query}_` : " / to filter";
  const sidebar = sidebarVisible ? "[Tab hide sidebar]" : "[Tab/Esc sidebar]";
  return `MDUI ${modeLabel(vimMode)} • ${sidebar} • ${filter} • ${shown}/${total} Markdown files`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
