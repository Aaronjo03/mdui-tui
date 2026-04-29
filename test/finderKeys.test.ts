import { describe, expect, it } from "vitest";
import { decideFinderKey, type FinderKeyInput } from "../src/tui/finderKeys.js";

describe("finder key decisions", () => {
  it("passes j and k through for SelectRenderable navigation when filter is inactive", () => {
    expect(decideFinderKey({ routeType: "finder", filterActive: false, query: "" }, key("j"))).toEqual({ kind: "passThrough" });
    expect(decideFinderKey({ routeType: "finder", filterActive: false, query: "" }, key("k"))).toEqual({ kind: "passThrough" });
  });

  it("starts explicit filter mode with slash", () => {
    expect(decideFinderKey({ routeType: "finder", filterActive: false, query: "" }, key("/"))).toEqual({ kind: "startFilter" });
  });

  it("uses slash for document search only when the sidebar is hidden", () => {
    expect(decideFinderKey({ routeType: "document", filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" }, key("/"))).toEqual({
      kind: "startDocumentSearch",
    });
    expect(decideFinderKey({ routeType: "document", filterActive: false, query: "", sidebarVisible: true, vimMode: "normal" }, key("/"))).toEqual({
      kind: "startFilter",
    });
  });

  it("updates the filter only while filter mode is active", () => {
    expect(decideFinderKey({ routeType: "finder", filterActive: true, query: "re" }, key("a"))).toEqual({
      kind: "updateFilter",
      query: "rea",
    });
    expect(decideFinderKey({ routeType: "finder", filterActive: true, query: "rea" }, key("backspace"))).toEqual({
      kind: "updateFilter",
      query: "re",
    });
  });

  it("uses escape to return from document view or clear filter mode", () => {
    expect(decideFinderKey({ routeType: "document", filterActive: false, query: "", sidebarVisible: true, vimMode: "normal" }, key("escape"))).toEqual({
      kind: "backToFinder",
    });
    expect(decideFinderKey({ routeType: "document", filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" }, key("escape"))).toEqual({
      kind: "showSidebar",
    });
    expect(decideFinderKey({ routeType: "finder", filterActive: true, query: "read" }, key("escape"))).toEqual({ kind: "clearFilter" });
  });

  it("quits on q outside filter mode but types q inside filter mode", () => {
    expect(decideFinderKey({ routeType: "finder", filterActive: false, query: "" }, key("q"))).toEqual({ kind: "exit" });
    expect(decideFinderKey({ routeType: "finder", filterActive: true, query: "" }, key("q"))).toEqual({
      kind: "updateFilter",
      query: "q",
    });
  });

  it("copies highlighted text in document mode", () => {
    expect(decideFinderKey({ routeType: "document", filterActive: false, query: "" }, key("c"))).toEqual({ kind: "copySelection" });
  });

  it("yanks and exits visual modes with y", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false };

    expect(decideFinderKey({ ...state, vimMode: "normal" }, key("y"))).toEqual({ kind: "passThrough" });
    expect(decideFinderKey({ ...state, vimMode: "visual" }, key("y"))).toEqual({ kind: "yankAndExitVisual" });
    expect(decideFinderKey({ ...state, vimMode: "visualBlock" }, key("y"))).toEqual({ kind: "yankAndExitVisual" });
  });

  it("tracks read-only Vim visual modes", () => {
    const normal = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(normal, key("v"))).toEqual({ kind: "enterVisualMode" });
    expect(decideFinderKey(normal, { name: "v", ctrl: true, meta: false })).toEqual({ kind: "enterVisualBlockMode" });
    expect(decideFinderKey({ ...normal, vimMode: "visual" }, key("escape"))).toEqual({ kind: "exitVisualMode" });
    expect(decideFinderKey({ ...normal, vimMode: "visualBlock" }, key("escape"))).toEqual({ kind: "exitVisualMode" });
  });

  it("toggles sidebar with tab in document mode", () => {
    expect(decideFinderKey({ routeType: "document", filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" }, key("tab"))).toEqual({
      kind: "toggleSidebar",
    });
  });

  it("supports export and Slack-copy document actions", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, { name: "y", ctrl: true, meta: false })).toEqual({ kind: "copySlack" });
    expect(decideFinderKey(state, { name: "p", ctrl: true, meta: false })).toEqual({ kind: "exportPdf" });
  });

  it("toggles help with Ctrl-? key variants", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, { name: "?", ctrl: true, meta: false })).toEqual({ kind: "toggleHelp" });
    expect(decideFinderKey(state, { name: "/", ctrl: true, meta: false })).toEqual({ kind: "toggleHelp" });
    expect(decideFinderKey(state, { name: "", ctrl: true, meta: false, sequence: "\u001F" })).toEqual({ kind: "toggleHelp" });
  });

  it("supports vim-style document scroll motions", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, { name: "d", ctrl: true, meta: false })).toEqual({ kind: "scrollHalfPageDown" });
    expect(decideFinderKey(state, { name: "u", ctrl: true, meta: false })).toEqual({ kind: "scrollHalfPageUp" });
    expect(decideFinderKey(state, { name: "f", ctrl: true, meta: false })).toEqual({ kind: "scrollPageDown" });
    expect(decideFinderKey(state, { name: "b", ctrl: true, meta: false })).toEqual({ kind: "scrollPageUp" });
    expect(decideFinderKey(state, key("g"))).toEqual({ kind: "startGoPrefix" });
    expect(decideFinderKey({ ...state, goPrefixActive: true }, key("g"))).toEqual({ kind: "scrollToTop" });
    expect(decideFinderKey(state, key("G"))).toEqual({ kind: "scrollToBottom" });
  });

  it("supports count-prefixed G line jumps", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const, countPrefix: "42" };

    expect(decideFinderKey(state, key("G"))).toEqual({ kind: "jumpToLine", line: 42 });
  });

  it("supports search repeat, ToC, and internal link history keys", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, key("n"))).toEqual({ kind: "nextSearchMatch" });
    expect(decideFinderKey(state, key("N"))).toEqual({ kind: "previousSearchMatch" });
    expect(decideFinderKey(state, key("t"))).toEqual({ kind: "toggleToc" });
    expect(decideFinderKey(state, { name: "o", ctrl: true, meta: false })).toEqual({ kind: "navigateBack" });
    expect(decideFinderKey(state, { name: "i", ctrl: true, meta: false })).toEqual({ kind: "navigateForward" });
  });

  it("supports read-only character cursor movement", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, key("h"))).toEqual({ kind: "moveCursorLeft" });
    expect(decideFinderKey(state, key("j"))).toEqual({ kind: "moveCursorDown" });
    expect(decideFinderKey(state, key("k"))).toEqual({ kind: "moveCursorUp" });
    expect(decideFinderKey(state, key("l"))).toEqual({ kind: "moveCursorRight" });
  });

  it("accumulates vim count prefixes before document motions", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, key("8"))).toEqual({ kind: "accumulateCount", digit: "8" });
    expect(decideFinderKey({ ...state, countPrefix: "8" }, key("0"))).toEqual({ kind: "accumulateCount", digit: "0" });
    expect(decideFinderKey(state, key("0"))).toEqual({ kind: "moveCursorLineStart" });
  });

  it("opens links from document mode", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, key("o"))).toEqual({ kind: "openLink" });
    expect(decideFinderKey(state, key("enter"))).toEqual({ kind: "openLink" });
  });

  it("passes movement keys through to the file selector while sidebar is visible", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: true, vimMode: "normal" as const };

    expect(decideFinderKey(state, key("j"))).toEqual({ kind: "passThrough" });
    expect(decideFinderKey(state, key("k"))).toEqual({ kind: "passThrough" });
    expect(decideFinderKey(state, key("down"))).toEqual({ kind: "passThrough" });
  });

  it("updates and clears document search", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "ta", sidebarVisible: false, vimMode: "normal" as const, documentSearchActive: true };

    expect(decideFinderKey(state, key("b"))).toEqual({ kind: "updateDocumentSearch", query: "tab" });
    expect(decideFinderKey(state, key("backspace"))).toEqual({ kind: "updateDocumentSearch", query: "t" });
    expect(decideFinderKey(state, key("escape"))).toEqual({ kind: "clearDocumentSearch" });
  });

  it("confirms document search on Enter", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "test", sidebarVisible: false, vimMode: "normal" as const, documentSearchActive: true };

    expect(decideFinderKey(state, key("enter"))).toEqual({ kind: "confirmDocumentSearch" });
  });

  it("navigates search matches with n and p", () => {
    const state = { routeType: "document" as const, filterActive: false, query: "", sidebarVisible: false, vimMode: "normal" as const };

    expect(decideFinderKey(state, key("n"))).toEqual({ kind: "nextSearchMatch" });
    expect(decideFinderKey(state, key("p"))).toEqual({ kind: "previousSearchMatch" });
  });

  it("does not steal c from finder filtering", () => {
    expect(decideFinderKey({ routeType: "finder", filterActive: true, query: "" }, key("c"))).toEqual({
      kind: "updateFilter",
      query: "c",
    });
  });
});

function key(name: string): FinderKeyInput {
  return { name, ctrl: false, meta: false };
}
