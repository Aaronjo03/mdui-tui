import { readFile, rm, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { spawn } from "node:child_process";
import type { MduiConfig } from "../config/config.js";
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
  MouseButton,
  type MouseEvent,
  type SelectOption,
} from "@opentui/core";
import { exportMarkdownToPdf } from "../export/pdf.js";
import { markdownToSlackMrkdwn } from "../export/slack.js";
import { discoverMarkdownFiles, type MarkdownFile } from "../fs/markdownFiles.js";
import { fetchRemoteMarkdown, resolveRemoteMarkdownUrl, type RemoteMarkdownDocument } from "../fs/remoteMarkdown.js";
import { filterFiles, type RankedFile } from "../finder/filterFiles.js";
import {
  firstRenderedDocumentLink,
  renderedDocumentLinkAt,
  resolveInternalMarkdownFile,
  type ParsedDocumentLink,
} from "../markdown/links.js";
import { renderMarkdownToAnsi } from "../render/markdownToAnsi.js";
import { copyToClipboard, readFromNativeClipboard } from "./clipboard.js";
import { syncCursorToViewportState } from "./cursorState.js";
import { documentRenderWidth, lineNumberGutterWidth } from "./documentRenderWidth.js";
import { isStableFileSnapshot, shouldReloadFileByMtime } from "./fileReload.js";
import { documentStats, formatDocumentStats, type DocumentStats } from "./documentStats.js";
import { decideFinderKey, type VimMode } from "./finderKeys.js";
import { closestSearchMatchIndex, findSearchMatches, wrapSearchMatchIndex, type SearchMatch } from "./search.js";
import { footerText, headerText, helpPanelText } from "./text.js";
import { extractToc, formatToc, type TocEntry } from "./toc.js";

export interface TuiOptions extends MduiConfig {
  readonly rootDirectory: string;
  readonly initialRemoteDocument?: RemoteMarkdownDocument;
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
  urlInputActive: boolean;
  urlInputQuery: string;
  ranked: readonly RankedFile[];
  documentText: string;
  markdownSource: string;
  documentLines: readonly string[];
  documentSearchActive: boolean;
  documentSearchQuery: string;
  searchMatches: readonly SearchMatch[];
  searchMatchIndex: number;
  searchConfirmed: boolean;
  documentStats: DocumentStats;
  tocEntries: readonly TocEntry[];
  tocVisible: boolean;
  cursorLine: number;
  cursorColumn: number;
  cursorPreferredColumn: number;
  cursorViewportRow: number;
  visualAnchorLine: number;
  visualAnchorColumn: number;
  goPrefixActive: boolean;
  countPrefix: string;
  helpVisible: boolean;
  notice: string;
  sidebarVisible: boolean;
  vimMode: VimMode;
  wrapEnabled: boolean;
  zoomLevel: number;
}

interface RemoteDocumentMetadata {
  readonly sourceUrl: string;
  readonly tempDirectory: string;
}

export async function runTui(options: TuiOptions): Promise<void> {
  const files = await discoverMarkdownFiles({
    rootDirectory: options.rootDirectory,
    ...(options.includeHidden !== undefined ? { includeHidden: options.includeHidden } : {}),
    ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    ...(options.ignoredDirectories !== undefined ? { ignoredDirectories: options.ignoredDirectories } : {}),
  });
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
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer);
    }
    if (currentFilePollTimer !== undefined) {
      clearInterval(currentFilePollTimer);
    }
    closeCurrentFileWatcher();
    void cleanupRemoteDocuments();
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
    urlInputActive: false,
    urlInputQuery: "",
    ranked: filterFiles(files, ""),
    documentText: "",
    markdownSource: "",
    documentLines: [],
    documentSearchActive: false,
    documentSearchQuery: "",
    searchMatches: [],
    searchMatchIndex: -1,
    searchConfirmed: false,
    documentStats: documentStats(""),
    tocEntries: [],
    tocVisible: false,
    cursorLine: 0,
    cursorColumn: 0,
    cursorPreferredColumn: 0,
    cursorViewportRow: 0,
    visualAnchorLine: 0,
    visualAnchorColumn: 0,
    goPrefixActive: false,
    countPrefix: "",
    helpVisible: false,
    notice: "",
    sidebarVisible: true,
    vimMode: "normal",
    wrapEnabled: true,
    zoomLevel: 0,
  };
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeVersion = 0;
  const documentPositions = new Map<string, DocumentPosition>();
  const backStack: MarkdownFile[] = [];
  const forwardStack: MarkdownFile[] = [];
  let currentFileWatcher: FSWatcher | undefined;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let currentFilePollTimer: ReturnType<typeof setInterval> | undefined;
  let currentFileLastReadMtimeMs: number | undefined;
  let documentLoadGeneration = 0;
  let remoteOpenGeneration = 0;
  const remoteDocuments = new Map<string, RemoteDocumentMetadata>();

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

  const tocPanel = new BoxRenderable(renderer, {
    id: "mdui-toc-panel",
    position: "absolute",
    top: 2,
    left: 4,
    width: 72,
    height: 24,
    zIndex: 80,
    border: true,
    borderStyle: "rounded",
    borderColor: "#C4A7E7",
    backgroundColor: "#111827",
    title: " Table of contents ",
    padding: 1,
    visible: false,
  });
  renderer.root.add(tocPanel);

  const tocPanelScroll = new ScrollBoxRenderable(renderer, {
    id: "mdui-toc-panel-scroll",
    width: "100%",
    height: "100%",
    scrollY: true,
    scrollX: false,
    viewportCulling: false,
  });
  tocPanel.add(tocPanelScroll);

  const tocPanelBody = new TextRenderable(renderer, {
    id: "mdui-toc-panel-body",
    content: "",
    fg: "#E5E7EB",
    bg: "#111827",
    width: "100%",
  });
  tocPanelScroll.add(tocPanelBody);

  const header = new TextRenderable(renderer, {
    id: "mdui-header",
    content: headerText(
      state.query,
      state.ranked.length,
      files.length,
      state.filterActive,
      state.vimMode,
      state.sidebarVisible,
      {
        active: state.urlInputActive,
        query: state.urlInputQuery,
      },
      {
        active: state.documentSearchActive || state.searchMatches.length > 0,
        query: state.documentSearchQuery,
        ...(state.searchMatches.length > 0
          ? { match: `${state.searchMatchIndex + 1}/${state.searchMatches.length}` }
          : {}),
      },
    ),
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
    tableOptions: markdownTableOptions(state.wrapEnabled),
  });
  viewerMarkdown.selectable = true;

  const searchHighlightOverlays = Array.from({ length: 96 }, (_, index) => {
    const overlay = new TextRenderable(renderer, {
      id: `mdui-search-highlight-${index}`,
      content: "",
      position: "absolute",
      top: 0,
      left: 0,
      zIndex: 70,
      fg: "#111827",
      bg: "#FDE68A",
      visible: false,
    });
    renderer.root.add(overlay);
    return overlay;
  });

  viewerMarkdown.onMouseUp = (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT || state.helpVisible || state.tocVisible || state.route.type !== "document") {
      return;
    }
    const handled = openLinkAtScreenPosition(event.x, event.y);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const lineNumbers = new TextRenderable(renderer, {
    id: "mdui-line-numbers",
    content: "",
    width: lineNumberGutterWidth(0),
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

    if (state.tocVisible && isOverlayCloseKey(key)) {
      state.tocVisible = false;
      refreshChrome();
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (state.tocVisible && isHelpScrollKey(key)) {
      scrollTocPanel(key);
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (state.tocVisible && !(key.ctrl && key.name === "c")) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    const resetGoPrefix =
      state.goPrefixActive && !(state.route.type === "document" && key.name === "g" && !key.ctrl && !key.meta);
    if (resetGoPrefix) {
      state.goPrefixActive = false;
    }
    const decision = decideFinderKey(
      {
        routeType: state.route.type,
        filterActive: state.filterActive,
        query: activePromptQuery(),
        sidebarVisible: state.sidebarVisible,
        vimMode: state.vimMode,
        documentSearchActive: state.documentSearchActive,
        urlInputActive: state.urlInputActive,
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
        state.urlInputActive = false;
        state.urlInputQuery = "";
        state.documentText = "";
        state.markdownSource = "";
        state.documentLines = [];
        state.documentSearchActive = false;
        state.documentSearchQuery = "";
        state.searchConfirmed = false;
        state.searchMatches = [];
        state.searchMatchIndex = -1;
        state.documentStats = documentStats("");
        state.tocEntries = [];
        state.tocVisible = false;
        state.cursorLine = 0;
        state.cursorColumn = 0;
        state.cursorPreferredColumn = 0;
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
        closeCurrentFileWatcher();
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
        state.searchConfirmed = false;
        state.searchMatches = [];
        state.searchMatchIndex = -1;
        state.tocVisible = false;
        refreshChrome();
        void applySidebarVisibilityAndRefreshDocument();
        finder.focus();
        key.preventDefault();
        return;
      case "toggleSidebar":
        rememberCurrentDocumentPosition();
        state.sidebarVisible = !state.sidebarVisible;
        refreshChrome();
        void applySidebarVisibilityAndRefreshDocument();
        if (state.sidebarVisible) {
          state.documentSearchActive = false;
          state.documentSearchQuery = "";
          state.searchConfirmed = false;
          state.searchMatches = [];
          state.searchMatchIndex = -1;
          finder.focus();
        } else {
          viewer.focus();
        }
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
      case "startUrlInput":
        state.urlInputActive = true;
        state.urlInputQuery = "";
        state.filterActive = false;
        state.documentSearchActive = false;
        state.documentSearchQuery = "";
        state.searchConfirmed = false;
        state.searchMatches = [];
        state.searchMatchIndex = -1;
        state.goPrefixActive = false;
        state.countPrefix = "";
        state.tocVisible = false;
        renderer.clearSelection();
        refreshChrome();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "updateUrlInput":
        state.urlInputQuery = decision.query;
        refreshChrome();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "pasteUrlInput": {
        const pasted = urlInputClipboardText(readFromNativeClipboard());
        if (pasted.length === 0) {
          showNotice("Clipboard is empty");
        } else {
          state.urlInputQuery = `${state.urlInputQuery}${pasted}`;
          refreshChrome();
        }
        key.preventDefault();
        key.stopPropagation();
        return;
      }
      case "clearUrlInput":
        state.urlInputActive = false;
        state.urlInputQuery = "";
        refreshChrome();
        updateDocumentCursor();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "confirmUrlInput": {
        const url = state.urlInputQuery.trim();
        state.urlInputActive = false;
        state.urlInputQuery = "";
        refreshChrome();
        if (url.length === 0) {
          showNotice("URL prompt cancelled");
          key.preventDefault();
          key.stopPropagation();
          return;
        }
        void openRemoteMarkdownFromInput(url).catch((error: unknown) => {
          showNotice(error instanceof Error ? `Remote open failed: ${error.message}` : "Remote open failed");
        });
        key.preventDefault();
        key.stopPropagation();
        return;
      }
      case "zoomIn":
        state.countPrefix = "";
        state.zoomLevel = clamp(state.zoomLevel + 1, -4, 6);
        refreshDocumentRender();
        applyDocumentLayout();
        clampScrollTop();
        clampCursorToViewportStartIfNeeded();
        refreshChrome();
        updateDocumentCursor();
        showNotice(`Zoom ${state.zoomLevel > 0 ? "+" : ""}${state.zoomLevel}`);
        key.preventDefault();
        key.stopPropagation();
        return;
      case "zoomOut":
        state.countPrefix = "";
        state.zoomLevel = clamp(state.zoomLevel - 1, -4, 6);
        refreshDocumentRender();
        applyDocumentLayout();
        clampScrollTop();
        clampCursorToViewportStartIfNeeded();
        refreshChrome();
        updateDocumentCursor();
        showNotice(`Zoom ${state.zoomLevel > 0 ? "+" : ""}${state.zoomLevel}`);
        key.preventDefault();
        key.stopPropagation();
        return;
      case "openLink":
        openCurrentLineLink();
        resetCountPrefix();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "navigateBack":
        navigateHistory("back");
        resetCountPrefix();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "navigateForward":
        navigateHistory("forward");
        resetCountPrefix();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "toggleToc":
        state.tocVisible = !state.tocVisible;
        tocPanelScroll.scrollTop = 0;
        resetCountPrefix();
        refreshChrome();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "toggleWrap":
        state.wrapEnabled = !state.wrapEnabled;
        state.countPrefix = "";
        refreshDocumentRender();
        applyDocumentLayout();
        clampScrollTop();
        clampCursorToViewportStartIfNeeded();
        refreshChrome();
        updateDocumentCursor();
        showNotice(state.wrapEnabled ? "Line wrapping on" : "Line wrapping off");
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
          state.searchConfirmed = false;
          state.searchMatches = [];
          state.searchMatchIndex = -1;
          helpPanelScroll.scrollTop = 0;
          renderer.clearSelection();
        }
        refreshChrome();
        key.preventDefault();
        key.stopPropagation();
        return;
      case "startDocumentSearch":
        state.countPrefix = "";
        state.urlInputActive = false;
        state.urlInputQuery = "";
        state.documentSearchActive = true;
        state.documentSearchQuery = "";
        state.searchConfirmed = false;
        state.searchMatches = [];
        state.searchMatchIndex = -1;
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
        state.searchConfirmed = false;
        state.searchMatches = [];
        state.searchMatchIndex = -1;
        renderer.clearSelection();
        refreshChrome();
        updateDocumentCursor();
        key.preventDefault();
        return;
      case "confirmDocumentSearch":
        state.documentSearchActive = false;
        state.searchConfirmed = true;
        state.searchMatches = findAllSearchMatches(state.documentSearchQuery);
        if (state.searchMatches.length > 0) {
          navigateToMatch(closestSearchMatchIndex(state.searchMatches, state.cursorLine, state.cursorColumn));
        }
        state.countPrefix = "";
        refreshChrome();
        key.preventDefault();
        return;
      case "nextSearchMatch":
        if (state.searchMatches.length > 0) {
          navigateToMatch(wrapSearchMatchIndex(state.searchMatchIndex + 1, state.searchMatches.length));
        }
        resetCountPrefix();
        key.preventDefault();
        return;
      case "previousSearchMatch":
        if (state.searchMatches.length > 0) {
          navigateToMatch(wrapSearchMatchIndex(state.searchMatchIndex - 1, state.searchMatches.length));
        }
        resetCountPrefix();
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
        state.cursorPreferredColumn = 0;
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
        scrollDocumentBy(0.5);
        key.preventDefault();
        return;
      case "scrollHalfPageUp":
        scrollDocumentBy(-0.5);
        key.preventDefault();
        return;
      case "scrollPageDown":
        scrollDocumentBy(1);
        key.preventDefault();
        return;
      case "scrollPageUp":
        scrollDocumentBy(-1);
        key.preventDefault();
        return;
      case "scrollToTop":
        state.goPrefixActive = false;
        state.countPrefix = "";
        viewer.scrollTop = 0;
        state.cursorLine = 0;
        state.cursorColumn = 0;
        state.cursorPreferredColumn = 0;
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
        state.cursorPreferredColumn = 0;
        state.cursorViewportRow = clamp(state.cursorLine - viewer.scrollTop, 0, visibleDocumentRows() - 1);
        refreshChrome();
        updateDocumentCursor();
        rememberCurrentDocumentPosition();
        key.preventDefault();
        return;
      case "jumpToLine":
        state.goPrefixActive = false;
        state.countPrefix = "";
        state.cursorLine = clamp(decision.line - 1, 0, Math.max(0, state.documentLines.length - 1));
        state.cursorColumn = 0;
        state.cursorPreferredColumn = 0;
        ensureCursorVisible();
        refreshChrome();
        updateDocumentCursor();
        updateVisualSelection();
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
        state.urlInputActive = false;
        state.urlInputQuery = "";
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
  if (options.initialRemoteDocument !== undefined) {
    remoteDocuments.set(options.initialRemoteDocument.file.absolutePath, {
      sourceUrl: options.initialRemoteDocument.sourceUrl,
      tempDirectory: options.initialRemoteDocument.tempDirectory,
    });
    void openDocument(options.initialRemoteDocument.file, { pushHistory: false }).catch((error: unknown) => {
      showNotice(error instanceof Error ? `Remote open failed: ${error.message}` : "Remote open failed");
    });
  }

  async function openSelected(): Promise<void> {
    const selected = selectedRankedFile(state.ranked, finder.getSelectedIndex());
    if (selected === undefined) {
      return;
    }
    rememberCurrentDocumentPosition();
    await openDocument(selected.file, { pushHistory: false });
  }

  async function openDocument(file: MarkdownFile, options: { readonly pushHistory: boolean }): Promise<void> {
    if (options.pushHistory && state.route.type === "document") {
      rememberCurrentDocumentPosition();
      backStack.push(state.route.file);
      forwardStack.splice(0);
    }
    state.route = { type: "document", file };
    state.filterActive = false;
    state.sidebarVisible = false;
    state.vimMode = "normal";
    state.documentSearchActive = false;
    state.documentSearchQuery = "";
    state.visualAnchorLine = 0;
    state.visualAnchorColumn = 0;
    state.goPrefixActive = false;
    state.countPrefix = "";
    state.tocVisible = false;
    renderer.clearSelection();
    applySidebarVisibility();
    await waitForRendererIdle();
    const loaded = await loadDocument(file);
    if (!loaded) {
      return;
    }
    refreshChrome();
    watchCurrentFile(file);
    await placeDocumentCursorAfterLayout();
    viewer.focus();
  }

  async function readStableDocument(
    file: MarkdownFile,
  ): Promise<{ readonly markdown: string; readonly mtimeMs: number }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await stat(file.absolutePath);
      const markdown = await readFile(file.absolutePath, "utf8");
      const after = await stat(file.absolutePath);
      if (isStableFileSnapshot(before, after)) {
        return { markdown, mtimeMs: after.mtimeMs };
      }
      await waitForStableFileRetry();
    }
    throw new Error("File changed while reading; waiting for stable snapshot");
  }

  async function waitForStableFileRetry(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  async function loadDocument(file: MarkdownFile): Promise<boolean> {
    if (exiting) {
      return false;
    }
    const loadGeneration = ++documentLoadGeneration;
    let snapshot: { readonly markdown: string; readonly mtimeMs: number };
    try {
      snapshot = await readStableDocument(file);
    } catch (error) {
      if (exiting) {
        return false;
      }
      throw error;
    }
    if (exiting || !isCurrentDocumentLoad(file, loadGeneration)) {
      return false;
    }
    viewer.title = ` ${basename(file.relativePath)} `;
    renderer.setTerminalTitle(`MDUI - ${file.relativePath}`);
    state.markdownSource = snapshot.markdown;
    refreshDocumentRender();
    state.documentStats = documentStats(snapshot.markdown);
    state.tocEntries = extractToc(snapshot.markdown);
    state.searchMatches = state.searchConfirmed ? findAllSearchMatches(state.documentSearchQuery) : [];
    currentFileLastReadMtimeMs = snapshot.mtimeMs;
    restoreDocumentPosition(file.absolutePath);
    viewerMarkdown.content = snapshot.markdown;
    applyDocumentLayout();
    return true;
  }

  function isCurrentDocumentLoad(file: MarkdownFile, loadGeneration: number): boolean {
    return (
      state.route.type === "document" &&
      state.route.file.absolutePath === file.absolutePath &&
      documentLoadGeneration === loadGeneration
    );
  }

  async function placeDocumentCursorAfterLayout(): Promise<void> {
    renderer.requestRender();
    await waitForRendererIdle();
    updateDocumentCursor();
  }

  async function waitForRendererIdle(): Promise<void> {
    await renderer.idle();
  }

  function refreshFinder(): void {
    state.ranked = filterFiles(files, state.query);
    finder.options = rankedToOptions(state.ranked);
    finder.selectedIndex = 0;
    refreshChrome();
  }

  function refreshChrome(): void {
    header.content = headerText(
      state.query,
      state.ranked.length,
      files.length,
      state.filterActive,
      state.vimMode,
      state.sidebarVisible,
      {
        active: state.urlInputActive,
        query: state.urlInputQuery,
      },
      {
        active: state.documentSearchActive || state.searchMatches.length > 0,
        query: state.documentSearchQuery,
        ...(state.searchMatches.length > 0
          ? { match: `${state.searchMatchIndex + 1}/${state.searchMatches.length}` }
          : {}),
      },
    );
    footer.content = footerText(state.notice, footerState());
    lineNumbers.visible = state.route.type === "document";
    lineNumbers.width = lineNumberGutterWidth(state.documentLines.length);
    lineNumbers.content = state.route.type === "document" ? lineNumberText(state.documentLines.length) : "";
    helpPanel.visible = state.helpVisible;
    tocPanel.visible = state.tocVisible;
    tocPanelBody.content = formatToc(state.tocEntries);
    layoutHelpPanel();
    layoutTocPanel();
    updateSearchHighlightOverlay();
  }

  function repeatCount(): number {
    const parsed = Number.parseInt(state.countPrefix, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function resetCountPrefix(): void {
    state.countPrefix = "";
    refreshChrome();
  }

  function activePromptQuery(): string {
    if (state.urlInputActive) {
      return state.urlInputQuery;
    }
    return state.documentSearchActive ? state.documentSearchQuery : state.query;
  }

  function lineNumberText(lineCount: number): string {
    const width = lineNumberGutterWidth(lineCount) - 1;
    return Array.from({ length: Math.max(1, lineCount) }, (_, index) => `${String(index).padStart(width, " ")} `).join(
      "\n",
    );
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

  function layoutTocPanel(): void {
    const panelWidth = clamp(72, 36, Math.max(36, renderer.terminalWidth - 6));
    const panelHeight = clamp(24, 12, Math.max(12, renderer.terminalHeight - 6));
    tocPanel.width = panelWidth;
    tocPanel.height = panelHeight;
    tocPanelScroll.height = Math.max(1, panelHeight - 4);
    tocPanel.left = Math.max(1, Math.floor((renderer.terminalWidth - panelWidth) / 2));
    tocPanel.top = Math.max(1, Math.floor((renderer.terminalHeight - panelHeight) / 2));
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

  function scrollTocPanel(key: KeyEvent): void {
    if (key.name === "up" || key.name === "k") {
      tocPanelScroll.scrollBy(-1, "step");
      return;
    }
    if (key.name === "down" || key.name === "j") {
      tocPanelScroll.scrollBy(1, "step");
      return;
    }
    if (key.ctrl && key.name === "u") {
      tocPanelScroll.scrollBy(-0.5, "viewport");
      return;
    }
    tocPanelScroll.scrollBy(0.5, "viewport");
  }

  function updateSearchHighlightOverlay(): void {
    hideSearchHighlightOverlays();
    if (
      state.route.type !== "document" ||
      state.sidebarVisible ||
      state.documentSearchQuery.length === 0 ||
      state.searchMatches.length === 0
    ) {
      return;
    }
    let overlayIndex = 0;
    for (const [matchIndex, match] of state.searchMatches.entries()) {
      const position = cursorScreenPosition(match.line, match.column);
      if (position === undefined) {
        continue;
      }
      const overlay = searchHighlightOverlays[overlayIndex];
      if (overlay === undefined) {
        return;
      }
      overlay.left = position.x;
      overlay.top = position.y;
      overlay.bg = matchIndex === state.searchMatchIndex ? "#FDE68A" : "#334155";
      overlay.fg = matchIndex === state.searchMatchIndex ? "#111827" : "#E5E7EB";
      overlay.content = (state.documentLines[match.line] ?? "").slice(match.column, match.column + match.length);
      overlay.visible = true;
      overlayIndex += 1;
    }
  }

  function hideSearchHighlightOverlays(): void {
    for (const overlay of searchHighlightOverlays) {
      overlay.visible = false;
      overlay.content = "";
    }
  }

  function rememberCurrentDocumentPosition(): void {
    if (state.route.type !== "document") {
      return;
    }
    documentPositions.set(state.route.file.absolutePath, {
      cursorLine: state.cursorLine,
      cursorColumn: state.cursorColumn,
      scrollTop: viewer.scrollTop,
    });
  }

  function navigateHistory(direction: "back" | "forward"): void {
    if (state.route.type !== "document") {
      return;
    }
    const sourceStack = direction === "back" ? backStack : forwardStack;
    const target = sourceStack.pop();
    if (target === undefined) {
      showNotice(direction === "back" ? "No previous document" : "No next document");
      return;
    }
    rememberCurrentDocumentPosition();
    const destinationStack = direction === "back" ? forwardStack : backStack;
    destinationStack.push(state.route.file);
    void openDocument(target, { pushHistory: false }).catch((error: unknown) => {
      showNotice(error instanceof Error ? `Navigation failed: ${error.message}` : "Navigation failed");
    });
  }

  function watchCurrentFile(file: MarkdownFile): void {
    closeCurrentFileWatcher();
    if (remoteDocuments.has(file.absolutePath)) {
      currentFileLastReadMtimeMs = undefined;
      return;
    }
    currentFilePollTimer = setInterval(() => {
      void reloadCurrentDocument(file).catch((error: unknown) => {
        showNotice(error instanceof Error ? `Reload failed: ${error.message}` : "Reload failed");
      });
    }, 500);
    try {
      currentFileWatcher = watch(dirname(file.absolutePath), { persistent: false }, () => {
        if (reloadTimer !== undefined) {
          clearTimeout(reloadTimer);
        }
        reloadTimer = setTimeout(() => {
          void reloadCurrentDocument(file).catch((error: unknown) => {
            showNotice(error instanceof Error ? `Reload failed: ${error.message}` : "Reload failed");
          });
        }, 100);
      });
    } catch (error) {
      showNotice(error instanceof Error ? `Watch disabled: ${error.message}` : "Watch disabled");
    }
  }

  function closeCurrentFileWatcher(): void {
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
    }
    if (currentFilePollTimer !== undefined) {
      clearInterval(currentFilePollTimer);
      currentFilePollTimer = undefined;
    }
    if (currentFileWatcher === undefined) {
      return;
    }
    currentFileWatcher.close();
    currentFileWatcher = undefined;
  }

  async function reloadCurrentDocument(file: MarkdownFile): Promise<void> {
    if (state.route.type !== "document" || state.route.file.absolutePath !== file.absolutePath) {
      return;
    }
    if (!(await currentFileHasNewerMtime(file))) {
      return;
    }
    rememberCurrentDocumentPosition();
    const loaded = await loadDocument(file);
    if (!loaded) {
      return;
    }
    refreshChrome();
    await placeDocumentCursorAfterLayout();
    showNotice("Reloaded current file");
  }

  async function currentFileHasNewerMtime(file: MarkdownFile): Promise<boolean> {
    const metadata = await stat(file.absolutePath);
    return shouldReloadFileByMtime(metadata.mtimeMs, currentFileLastReadMtimeMs);
  }

  function restoreDocumentPosition(absolutePath: string): void {
    const savedPosition = documentPositions.get(absolutePath);
    if (savedPosition === undefined) {
      state.cursorLine = 0;
      state.cursorColumn = 0;
      state.cursorPreferredColumn = 0;
      state.cursorViewportRow = 0;
      viewer.scrollTop = 0;
      return;
    }
    state.cursorLine = clamp(savedPosition.cursorLine, 0, Math.max(0, state.documentLines.length - 1));
    state.cursorColumn = clamp(savedPosition.cursorColumn, 0, lineLength(state.cursorLine));
    state.cursorPreferredColumn = savedPosition.cursorColumn;
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
    readonly searchMatch?: string;
    readonly countPrefix?: string;
    readonly documentStats?: string;
    readonly wrapEnabled?: boolean;
    readonly zoomLevel?: number;
  } {
    return {
      vimMode: state.vimMode,
      sidebarVisible: state.sidebarVisible,
      wrapEnabled: state.wrapEnabled,
      zoomLevel: state.zoomLevel,
      ...(state.route.type === "document" ? { cursorLine: state.cursorLine, cursorColumn: state.cursorColumn } : {}),
      ...(state.vimMode !== "normal"
        ? { selectionAnchorLine: state.visualAnchorLine, selectionAnchorColumn: state.visualAnchorColumn }
        : {}),
      ...(state.documentSearchActive ? { searchQuery: state.documentSearchQuery } : {}),
      ...(state.searchMatches.length > 0
        ? { searchMatch: `${state.searchMatchIndex + 1}/${state.searchMatches.length}` }
        : {}),
      ...(state.countPrefix.length > 0 ? { countPrefix: state.countPrefix } : {}),
      ...(state.route.type === "document" ? { documentStats: formatDocumentStats(state.documentStats) } : {}),
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

  async function applySidebarVisibilityAndRefreshDocument(): Promise<void> {
    applySidebarVisibility();
    if (state.route.type !== "document") {
      return;
    }
    const absolutePath = state.route.file.absolutePath;
    await waitForRendererIdle();
    if (state.route.type !== "document" || state.route.file.absolutePath !== absolutePath) {
      return;
    }
    refreshDocumentRender();
    applyDocumentLayout();
    clampScrollTop();
    clampCursorToViewportStartIfNeeded();
    refreshChrome();
    updateDocumentCursor();
    updateVisualSelection();
  }

  function moveDocumentCursor(lineDelta: number, columnDelta: number): void {
    if (state.documentLines.length === 0) {
      return;
    }
    syncCursorToViewport();
    const nextLine = clamp(state.cursorLine + lineDelta, 0, state.documentLines.length - 1);
    const preferredColumn = lineDelta === 0 ? state.cursorColumn + columnDelta : state.cursorPreferredColumn;
    const nextColumn = clamp(preferredColumn, 0, lineLength(nextLine));
    state.cursorLine = nextLine;
    state.cursorColumn = nextColumn;
    state.cursorPreferredColumn = lineDelta === 0 ? nextColumn : preferredColumn;
    ensureCursorVisible();
    refreshChrome();
    updateDocumentCursor();
    updateVisualSelection();
    rememberCurrentDocumentPosition();
  }

  function scrollDocumentBy(amount: number): void {
    viewer.scrollBy(amount, "viewport");
    syncCursorToViewport();
    refreshChrome();
    updateDocumentCursor();
    updateVisualSelection();
    rememberCurrentDocumentPosition();
  }

  function findAllSearchMatches(query: string): readonly SearchMatch[] {
    return findSearchMatches(state.documentLines, query);
  }

  function navigateToMatch(index: number): void {
    if (state.searchMatches.length === 0) {
      return;
    }
    state.searchMatchIndex = index;
    const match = state.searchMatches[index];
    if (match === undefined) {
      return;
    }
    state.cursorLine = match.line;
    state.cursorColumn = match.column;
    state.cursorPreferredColumn = match.column;
    ensureCursorVisible();
    updateSearchSelection();
    rememberCurrentDocumentPosition();
    refreshChrome();
    updateDocumentCursor();
  }

  function moveCursorToSearchMatch(): void {
    const query = state.documentSearchQuery;
    if (query.length === 0) {
      state.searchMatches = [];
      state.searchMatchIndex = -1;
      renderer.clearSelection();
      return;
    }
    state.searchMatches = findAllSearchMatches(query);
    if (state.searchMatches.length === 0) {
      state.searchMatchIndex = -1;
      renderer.clearSelection();
      return;
    }
    state.searchMatchIndex = 0;
    const match = state.searchMatches[0];
    if (match === undefined) {
      return;
    }
    state.cursorLine = match.line;
    state.cursorColumn = match.column;
    state.cursorPreferredColumn = match.column;
    ensureCursorVisible();
    updateSearchSelection();
    rememberCurrentDocumentPosition();
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
    let row = state.cursorLine - viewer.scrollTop;
    const visibleRows = visibleDocumentRows();
    if (row < 0 || row >= visibleRows) {
      clampCursorToViewportStartIfNeeded();
      row = state.cursorLine - viewer.scrollTop;
      if (row < 0 || row >= visibleRows) {
        renderer.setCursorPosition(0, 0, false);
        return;
      }
    }
    state.cursorViewportRow = row;
    const x = clampedCursorScreenX(state.cursorColumn);
    const y = viewerMarkdown.screenY + row;
    renderer.setCursorStyle({ style: state.vimMode === "normal" ? "block" : "underline", blinking: true });
    renderer.setCursorPosition(x, y, true);
  }

  function syncCursorToViewport(): void {
    const synced = syncCursorToViewportState(
      { cursorLine: state.cursorLine, cursorColumn: state.cursorColumn, cursorViewportRow: state.cursorViewportRow },
      {
        documentLineCount: state.documentLines.length,
        scrollTop: viewer.scrollTop,
        visibleRows: visibleDocumentRows(),
      },
      lineLength,
    );
    state.cursorLine = synced.cursorLine;
    state.cursorColumn = clamp(state.cursorPreferredColumn, 0, lineLength(synced.cursorLine));
    state.cursorViewportRow = synced.cursorViewportRow;
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
    if (
      (!state.documentSearchActive && !state.searchConfirmed) ||
      state.documentSearchQuery.length === 0 ||
      state.sidebarVisible
    ) {
      return;
    }
    const start = cursorScreenPosition(state.cursorLine, state.cursorColumn);
    const end = cursorScreenPosition(
      state.cursorLine,
      state.cursorColumn + Math.max(1, state.documentSearchQuery.length),
    );
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
    return { x: clampedCursorScreenX(column), y: viewerMarkdown.screenY + row };
  }

  function clampedCursorScreenX(column: number): number {
    const maxX = Math.max(viewerMarkdown.screenX, viewer.screenX + viewer.width - 2);
    return clamp(viewerMarkdown.screenX + column, viewerMarkdown.screenX, maxX);
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
    const textToCopy =
      selectedText !== undefined && selectedText.length > 0
        ? selectedText
        : options.fallbackToDocument
          ? state.documentText.trim()
          : "";
    if (textToCopy.length === 0) {
      if (options.fallbackToDocument) {
        showNotice("Nothing to copy");
      }
      return false;
    }
    const copied = copyTextToClipboard(textToCopy);
    showNotice(
      copied
        ? selectedText !== undefined && selectedText.length > 0
          ? "Copied highlighted text"
          : "Copied document"
        : "Clipboard copy failed",
    );
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
    const link =
      selectedRenderedDocumentLink() ??
      renderedDocumentLinkAt(state.documentLines[state.cursorLine] ?? "", state.cursorColumn);
    if (link === undefined) {
      showNotice("No link at cursor");
      return;
    }
    openDocumentLink(link);
  }

  function selectedRenderedDocumentLink(): ParsedDocumentLink | undefined {
    const selectedText = renderer.getSelection()?.getSelectedText().trim();
    return selectedText !== undefined && selectedText.length > 0 ? firstRenderedDocumentLink(selectedText) : undefined;
  }

  function openDocumentLink(link: ParsedDocumentLink): void {
    if (state.route.type !== "document") {
      return;
    }
    if (link.kind === "external") {
      openUrlInBrowser(link.url);
      return;
    }
    if (link.kind === "remoteMarkdown") {
      void openRemoteMarkdownLink(link.url).catch((error: unknown) => {
        showNotice(error instanceof Error ? `Remote open failed: ${error.message}` : "Remote open failed");
      });
      return;
    }
    const remoteBase = remoteDocuments.get(state.route.file.absolutePath)?.sourceUrl;
    const remoteUrl = remoteBase === undefined ? undefined : resolveRemoteMarkdownUrl(remoteBase, link.target);
    if (remoteUrl !== undefined) {
      void openRemoteMarkdownLink(remoteUrl).catch((error: unknown) => {
        showNotice(error instanceof Error ? `Remote open failed: ${error.message}` : "Remote open failed");
      });
      return;
    }
    const targetFile = resolveInternalMarkdownFile(files, state.route.file, link.target);
    if (targetFile === undefined) {
      showNotice(`No Markdown file found for ${link.target}`);
      return;
    }
    void openDocument(targetFile, { pushHistory: true }).catch((error: unknown) => {
      showNotice(error instanceof Error ? `Open link failed: ${error.message}` : "Open link failed");
    });
  }

  async function openRemoteMarkdownLink(url: string): Promise<void> {
    await openFetchedRemoteMarkdown(url, { pushHistory: true });
  }

  async function openRemoteMarkdownFromInput(url: string): Promise<void> {
    await openFetchedRemoteMarkdown(url, { pushHistory: state.route.type === "document" });
  }

  async function openFetchedRemoteMarkdown(url: string, options: { readonly pushHistory: boolean }): Promise<void> {
    const openGeneration = ++remoteOpenGeneration;
    showNotice(`Fetching ${url}…`);
    const remote = await fetchRemoteMarkdown(url);
    if (exiting || openGeneration !== remoteOpenGeneration) {
      await rm(remote.tempDirectory, { recursive: true, force: true });
      return;
    }
    remoteDocuments.set(remote.file.absolutePath, { sourceUrl: remote.sourceUrl, tempDirectory: remote.tempDirectory });
    await openDocument(remote.file, { pushHistory: options.pushHistory });
    if (exiting || openGeneration !== remoteOpenGeneration) {
      return;
    }
    showNotice(`Opened ${remote.file.name} from ${new URL(remote.sourceUrl).hostname}`);
  }

  function openLinkAtScreenPosition(x: number, y: number): boolean {
    if (state.route.type !== "document") {
      return false;
    }
    const line = viewer.scrollTop + (y - viewerMarkdown.screenY);
    if (line < 0 || line >= state.documentLines.length) {
      return false;
    }
    const previousLine = state.cursorLine;
    const previousColumn = state.cursorColumn;
    const previousPreferredColumn = state.cursorPreferredColumn;
    const column = Math.max(0, x - viewerMarkdown.screenX);
    const link = renderedDocumentLinkAt(state.documentLines[line] ?? "", column);
    if (link === undefined) {
      state.cursorLine = previousLine;
      state.cursorColumn = previousColumn;
      state.cursorPreferredColumn = previousPreferredColumn;
      return false;
    }
    state.cursorLine = line;
    state.cursorColumn = column;
    state.cursorPreferredColumn = column;
    openDocumentLink(link);
    return true;
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
    const outputPath = await exportMarkdownToPdf(state.markdownSource, state.route.file.absolutePath, {
      ...(options.pdfOutputDirectory !== undefined ? { outputDirectory: options.pdfOutputDirectory } : {}),
    });
    showNotice(`Saved ${basename(outputPath)}`);
  }

  function copyTextToClipboard(text: string): boolean {
    try {
      return renderer.copyToClipboardOSC52(text) || copyToClipboard(text);
    } catch {
      return copyToClipboard(text);
    }
  }

  function applyDocumentLayout(): void {
    const effectiveWidth = currentDocumentRenderWidth();
    viewerMarkdown.tableOptions = markdownTableOptions(state.wrapEnabled);
    viewerMarkdown.width = effectiveWidth;
  }

  function refreshDocumentRender(): void {
    if (state.markdownSource.length === 0) {
      state.documentText = "";
      state.documentLines = [];
      state.searchMatches = [];
      state.searchMatchIndex = -1;
      return;
    }
    let rendered = "";
    let documentLines: string[] = [];
    let lineCount = state.documentLines.length;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      rendered = renderMarkdownToAnsi(state.markdownSource, {
        width: currentDocumentRenderWidth(lineCount),
        color: false,
      });
      documentLines = rendered.split("\n");
      if (lineNumberGutterWidth(documentLines.length) === lineNumberGutterWidth(lineCount)) {
        break;
      }
      lineCount = documentLines.length;
    }
    state.documentText = rendered;
    state.documentLines = documentLines;
    if (state.searchConfirmed || state.documentSearchActive) {
      state.searchMatches = findAllSearchMatches(state.documentSearchQuery);
      state.searchMatchIndex =
        state.searchMatches.length === 0 ? -1 : clamp(state.searchMatchIndex, 0, state.searchMatches.length - 1);
    }
    state.cursorLine = clamp(state.cursorLine, 0, Math.max(0, state.documentLines.length - 1));
    state.cursorColumn = clamp(state.cursorPreferredColumn, 0, lineLength(state.cursorLine));
  }

  function currentDocumentRenderWidth(lineCount = state.documentLines.length): number {
    return documentRenderWidth({
      wrapEnabled: state.wrapEnabled,
      zoomLevel: state.zoomLevel,
      viewerWidth: viewer.width,
      terminalWidth: renderer.terminalWidth,
      lineCount,
      lineNumbersVisible: state.route.type === "document",
    });
  }

  function clampScrollTop(): void {
    const maxScroll = Math.max(0, state.documentLines.length - 1);
    if (viewer.scrollTop > maxScroll) {
      viewer.scrollTop = maxScroll;
    }
  }

  function clampCursorToViewportStartIfNeeded(): void {
    if (state.documentLines.length === 0) {
      state.cursorLine = 0;
      state.cursorColumn = 0;
      state.cursorPreferredColumn = 0;
      state.cursorViewportRow = 0;
      return;
    }
    const firstVisible = clamp(viewer.scrollTop, 0, state.documentLines.length - 1);
    const lastVisible = clamp(firstVisible + visibleDocumentRows() - 1, 0, state.documentLines.length - 1);
    if (state.cursorLine < firstVisible || state.cursorLine > lastVisible) {
      state.cursorLine = firstVisible;
      state.cursorColumn = 0;
      state.cursorPreferredColumn = 0;
      state.cursorViewportRow = 0;
    }
  }

  async function cleanupRemoteDocuments(): Promise<void> {
    for (const [, meta] of remoteDocuments) {
      try {
        await rm(meta.tempDirectory, { recursive: true, force: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.emitWarning(`Unable to remove remote Markdown temp directory ${meta.tempDirectory}: ${message}`);
      }
    }
    remoteDocuments.clear();
  }

  function showNotice(message: string): void {
    if (exiting) {
      return;
    }
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

function urlInputClipboardText(text: string | undefined): string {
  if (text === undefined) {
    return "";
  }
  let clean = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint >= 32 && codePoint !== 127 && codePoint < 128) {
      clean += character;
    }
    if (codePoint !== undefined && codePoint > 159) {
      clean += character;
    }
  }
  return clean.trim();
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

function isOverlayCloseKey(key: KeyEvent): boolean {
  return key.name === "escape" || (!key.ctrl && !key.meta && key.name === "q");
}

function isHelpScrollKey(key: KeyEvent): boolean {
  return (
    key.name === "up" ||
    key.name === "down" ||
    key.name === "j" ||
    key.name === "k" ||
    (key.ctrl && (key.name === "d" || key.name === "u"))
  );
}

function isHelpToggleInput(key: KeyEvent): boolean {
  return (
    key.ctrl &&
    (key.name === "?" ||
      key.name === "/" ||
      key.sequence === "\u001F" ||
      key.raw === "\u001F" ||
      (key.shift && key.name === "/"))
  );
}

function browserOpenCommand(
  url: string,
): { readonly executable: string; readonly args: readonly string[] } | undefined {
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

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function markdownTableOptions(wrapEnabled: boolean) {
  return {
    style: "grid" as const,
    widthMode: "full" as const,
    wrapMode: wrapEnabled ? ("word" as const) : ("none" as const),
    cellPadding: 1,
    borders: true,
    outerBorder: true,
    borderStyle: "single" as const,
    borderColor: "#8B8FA3",
    selectable: true,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
