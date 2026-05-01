export interface FinderKeyState {
  readonly routeType: "finder" | "document";
  readonly filterActive: boolean;
  readonly query: string;
  readonly sidebarVisible?: boolean;
  readonly vimMode?: VimMode;
  readonly documentSearchActive?: boolean;
  readonly urlInputActive?: boolean;
  readonly goPrefixActive?: boolean;
  readonly countPrefix?: string;
}

export type VimMode = "normal" | "visual" | "visualBlock";

export interface FinderKeyInput {
  readonly name: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift?: boolean;
  readonly sequence?: string;
  readonly raw?: string;
}

export type FinderKeyDecision =
  | { readonly kind: "exit" }
  | { readonly kind: "backToFinder" }
  | { readonly kind: "showSidebar" }
  | { readonly kind: "toggleSidebar" }
  | { readonly kind: "enterVisualMode" }
  | { readonly kind: "enterVisualBlockMode" }
  | { readonly kind: "exitVisualMode" }
  | { readonly kind: "copySelection" }
  | { readonly kind: "yankAndExitVisual" }
  | { readonly kind: "copySlack" }
  | { readonly kind: "exportPdf" }
  | { readonly kind: "openLink" }
  | { readonly kind: "startDocumentSearch" }
  | { readonly kind: "startUrlInput" }
  | { readonly kind: "updateUrlInput"; readonly query: string }
  | { readonly kind: "pasteUrlInput" }
  | { readonly kind: "confirmUrlInput" }
  | { readonly kind: "clearUrlInput" }
  | { readonly kind: "updateDocumentSearch"; readonly query: string }
  | { readonly kind: "confirmDocumentSearch" }
  | { readonly kind: "clearDocumentSearch" }
  | { readonly kind: "nextSearchMatch" }
  | { readonly kind: "previousSearchMatch" }
  | { readonly kind: "moveCursorLeft" }
  | { readonly kind: "moveCursorRight" }
  | { readonly kind: "moveCursorUp" }
  | { readonly kind: "moveCursorDown" }
  | { readonly kind: "moveCursorLineStart" }
  | { readonly kind: "accumulateCount"; readonly digit: string }
  | { readonly kind: "startGoPrefix" }
  | { readonly kind: "scrollHalfPageDown" }
  | { readonly kind: "scrollHalfPageUp" }
  | { readonly kind: "scrollPageDown" }
  | { readonly kind: "scrollPageUp" }
  | { readonly kind: "scrollToTop" }
  | { readonly kind: "scrollToBottom" }
  | { readonly kind: "jumpToLine"; readonly line: number }
  | { readonly kind: "toggleToc" }
  | { readonly kind: "navigateBack" }
  | { readonly kind: "navigateForward" }
  | { readonly kind: "zoomIn" }
  | { readonly kind: "zoomOut" }
  | { readonly kind: "toggleWrap" }
  | { readonly kind: "startFilter" }
  | { readonly kind: "updateFilter"; readonly query: string }
  | { readonly kind: "clearFilter" }
  | { readonly kind: "toggleHelp" }
  | { readonly kind: "passThrough" };

export function decideFinderKey(state: FinderKeyState, key: FinderKeyInput): FinderKeyDecision {
  const vimMode = state.vimMode ?? "normal";
  const sidebarVisible = state.sidebarVisible ?? true;
  const documentSearchActive = state.documentSearchActive ?? false;
  const urlInputActive = state.urlInputActive ?? false;
  const goPrefixActive = state.goPrefixActive ?? false;
  const countPrefix = state.countPrefix ?? "";

  if (isHelpKey(key)) {
    return { kind: "toggleHelp" };
  }

  if (key.ctrl && key.name === "c") {
    return { kind: "exit" };
  }

  if (!urlInputActive && key.name === "u" && key.ctrl && !key.meta) {
    return { kind: "startUrlInput" };
  }

  if (key.name === "escape") {
    if (urlInputActive) {
      return { kind: "clearUrlInput" };
    }
    if (state.routeType === "document") {
      if (documentSearchActive) {
        return { kind: "clearDocumentSearch" };
      }
      if (vimMode !== "normal") {
        return { kind: "exitVisualMode" };
      }
      if (!sidebarVisible) {
        return { kind: "showSidebar" };
      }
      return { kind: "backToFinder" };
    }
    if (state.filterActive || state.query.length > 0) {
      return { kind: "clearFilter" };
    }
    return { kind: "passThrough" };
  }

  if (state.routeType === "document") {
    if (urlInputActive) {
      return decideUrlInputKey(state.query, key);
    }
    if (documentSearchActive) {
      if (key.name === "backspace" || key.name === "delete") {
        return { kind: "updateDocumentSearch", query: state.query.slice(0, -1) };
      }
      if (key.name === "enter" || key.name === "return") {
        return { kind: "confirmDocumentSearch" };
      }
      if (key.name.length === 1 && !key.ctrl && !key.meta) {
        return { kind: "updateDocumentSearch", query: `${state.query}${key.sequence ?? key.name}` };
      }
      return { kind: "passThrough" };
    }
    if (key.name === "c" && !key.ctrl && !key.meta) {
      return { kind: "copySelection" };
    }
    if (key.name === "tab" && !key.ctrl && !key.meta) {
      return { kind: "toggleSidebar" };
    }
    if (key.name === "y" && key.ctrl && !key.meta) {
      return { kind: "copySlack" };
    }
    if (key.name === "p" && key.ctrl && !key.meta) {
      return { kind: "exportPdf" };
    }
    if (key.ctrl && !key.meta && (key.name === "+" || key.name === "=")) {
      return { kind: "zoomIn" };
    }
    if (key.ctrl && !key.meta && key.name === "-") {
      return { kind: "zoomOut" };
    }
    if (key.name === "/" && !key.ctrl && !key.meta) {
      return sidebarVisible ? { kind: "startFilter" } : { kind: "startDocumentSearch" };
    }
    if (sidebarVisible) {
      return { kind: "passThrough" };
    }
    if (key.name === "n" && !key.ctrl && !key.meta) {
      return { kind: "nextSearchMatch" };
    }
    if ((key.name === "p" && !key.ctrl && !key.meta) || isPlainCharacter(key, "N")) {
      return { kind: "previousSearchMatch" };
    }
    if (isCountDigit(key, countPrefix)) {
      return { kind: "accumulateCount", digit: key.name };
    }
    if (key.name === "0" && countPrefix.length === 0 && !key.ctrl && !key.meta) {
      return { kind: "moveCursorLineStart" };
    }
    if ((key.name === "o" || key.name === "enter") && !key.ctrl && !key.meta) {
      return { kind: "openLink" };
    }
    if (key.name === "o" && key.ctrl && !key.meta) {
      return { kind: "navigateBack" };
    }
    if (key.name === "i" && key.ctrl && !key.meta) {
      return { kind: "navigateForward" };
    }
    if (key.name === "t" && !key.ctrl && !key.meta) {
      return { kind: "toggleToc" };
    }
    if (key.name === "w" && !key.ctrl && !key.meta) {
      return { kind: "toggleWrap" };
    }
    if (key.name === "y" && !key.ctrl && !key.meta && vimMode !== "normal") {
      return { kind: "yankAndExitVisual" };
    }
    if (key.name === "v" && key.ctrl && !key.meta) {
      return vimMode === "visualBlock" ? { kind: "exitVisualMode" } : { kind: "enterVisualBlockMode" };
    }
    if (key.name === "v" && !key.ctrl && !key.meta) {
      return vimMode === "visual" ? { kind: "exitVisualMode" } : { kind: "enterVisualMode" };
    }
    if (key.ctrl && key.name === "d") {
      return { kind: "scrollHalfPageDown" };
    }
    if (key.ctrl && key.name === "f") {
      return { kind: "scrollPageDown" };
    }
    if (key.ctrl && key.name === "b") {
      return { kind: "scrollPageUp" };
    }
    if ((key.name === "h" || key.name === "left") && !key.ctrl && !key.meta) {
      return { kind: "moveCursorLeft" };
    }
    if ((key.name === "l" || key.name === "right") && !key.ctrl && !key.meta) {
      return { kind: "moveCursorRight" };
    }
    if ((key.name === "j" || key.name === "down") && !key.ctrl && !key.meta) {
      return { kind: "moveCursorDown" };
    }
    if ((key.name === "k" || key.name === "up") && !key.ctrl && !key.meta) {
      return { kind: "moveCursorUp" };
    }
    if (key.name === "g" && !key.ctrl && !key.meta) {
      return goPrefixActive ? { kind: "scrollToTop" } : { kind: "startGoPrefix" };
    }
    if (isPlainCharacter(key, "G")) {
      if (countPrefix.length > 0) {
        return { kind: "jumpToLine", line: Number.parseInt(countPrefix, 10) };
      }
      return { kind: "scrollToBottom" };
    }
  }

  if (urlInputActive) {
    return decideUrlInputKey(state.query, key);
  }

  if (state.filterActive) {
    if (key.name === "backspace" || key.name === "delete") {
      return { kind: "updateFilter", query: state.query.slice(0, -1) };
    }
    if (key.name.length === 1 && !key.ctrl && !key.meta) {
      return { kind: "updateFilter", query: `${state.query}${key.name}` };
    }
    return { kind: "passThrough" };
  }

  if (key.name === "/") {
    return { kind: "startFilter" };
  }

  if (key.name === "q") {
    return { kind: "exit" };
  }

  return { kind: "passThrough" };
}

function isPlainCharacter(key: FinderKeyInput, character: string): boolean {
  return !key.ctrl && !key.meta && (key.name === character || key.sequence === character || key.raw === character);
}

function decideUrlInputKey(query: string, key: FinderKeyInput): FinderKeyDecision {
  if (key.name === "backspace" || key.name === "delete") {
    return { kind: "updateUrlInput", query: query.slice(0, -1) };
  }
  if (key.name === "enter" || key.name === "return") {
    return { kind: "confirmUrlInput" };
  }
  if (isUrlPasteKey(key)) {
    return { kind: "pasteUrlInput" };
  }
  const text = printableInputText(key);
  return text.length > 0 ? { kind: "updateUrlInput", query: `${query}${text}` } : { kind: "passThrough" };
}

function isUrlPasteKey(key: FinderKeyInput): boolean {
  if (key.meta && !key.ctrl && key.name.toLowerCase() === "v") {
    return true;
  }
  return key.ctrl && !key.meta && key.name.toLowerCase() === "v" && (key.shift === true || key.name === "V");
}

function printableInputText(key: FinderKeyInput): string {
  if (key.ctrl || key.meta) {
    return "";
  }
  const text = key.sequence ?? key.name;
  return text.length > 0 && !containsControlCharacter(text) ? text : "";
}

function containsControlCharacter(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || (codePoint >= 127 && codePoint <= 159))) {
      return true;
    }
  }
  return false;
}

function isCountDigit(key: FinderKeyInput, countPrefix: string): boolean {
  if (key.ctrl || key.meta || key.name.length !== 1 || !/[0-9]/.test(key.name)) {
    return false;
  }
  return key.name !== "0" || countPrefix.length > 0;
}

function isHelpKey(key: FinderKeyInput): boolean {
  return key.ctrl && (key.name === "?" || key.name === "/" || key.sequence === "\u001F" || key.raw === "\u001F" || (key.shift === true && key.name === "/"));
}
