import { describe, expect, it } from "vitest";
import { cliHelpText, footerText, headerText, helpPanelText } from "../src/tui/text.js";

describe("TUI text helpers", () => {
  it("includes compact help by default", () => {
    expect(footerText("")).toContain("arrows/hjkl move");
    expect(footerText("")).toContain("Tab/Esc sidebar");
    expect(footerText("")).toContain("Ctrl-Shift-? help");
  });

  it("shows the read-only Vim mode", () => {
    expect(footerText("", { vimMode: "normal" })).toContain("NORMAL");
    expect(footerText("", { vimMode: "visual" })).toContain("VISUAL");
    expect(footerText("", { vimMode: "visualBlock" })).toContain("V-BLOCK");
  });

  it("shows sidebar toggle help regardless of visibility", () => {
    expect(footerText("", { vimMode: "normal", sidebarVisible: true })).toContain("Tab/Esc sidebar");
    expect(footerText("", { vimMode: "normal", sidebarVisible: false })).toContain("Tab/Esc sidebar");
  });

  it("shows only cursor and document stats from document state", () => {
    const footer = footerText("", {
      vimMode: "normal",
      sidebarVisible: false,
      cursorLine: 4,
      cursorColumn: 2,
      documentStats: "837 words · 5 mins",
      searchQuery: "table",
      countPrefix: "8",
      wrapEnabled: false,
      zoomLevel: 2,
    });

    expect(footer).toContain("4:2");
    expect(footer).toContain("837 words · 5 mins");
    expect(footer).not.toContain("/table_");
    expect(footer).not.toContain("count 8");
    expect(footer).not.toContain("wrap off");
    expect(footer).not.toContain("zoom +2");
  });

  it("shows Slack copy and PDF export in help panel, not footer", () => {
    const help = helpPanelText();
    expect(help).toContain("Ctrl-y");
    expect(help).toContain("Ctrl-p");
    expect(help).toContain("Ctrl-/");
    expect(help).toContain("Ctrl-Shift-?");
    expect(footerText("")).not.toContain("Ctrl-y Slack");
    expect(footerText("")).not.toContain("Ctrl-p PDF");
    expect(footerText("")).not.toContain("8j counts");
    expect(footerText("")).not.toContain("y yank visual");
    expect(footerText("")).not.toContain("o open link");
    expect(footerText("")).not.toContain("t ToC");
  });

  it("appends copy notifications", () => {
    expect(footerText("Copied to clipboard")).toContain("Copied to clipboard");
  });

  it("shows remote URL usage in the finder header", () => {
    const header = headerText("", 4, 4, false, "normal", true);

    expect(header).toContain("Ctrl-u URL");
    expect(header).not.toContain("mdui <url.md> opens remote docs");
  });

  it("shows URL entry mode in the header", () => {
    const header = headerText("", 4, 4, false, "normal", true, {
      active: true,
      query: "https://telnyx.com/pricing.md",
    });

    expect(header).toContain("URL: https://telnyx.com/pricing.md_");
    expect(header).toContain("Enter opens remote Markdown");
    expect(header).toContain("Esc cancels");
  });

  it("shows document search mode in the header", () => {
    const header = headerText(
      "",
      4,
      4,
      false,
      "normal",
      false,
      { active: false, query: "" },
      { active: true, query: "price", match: "1/3" },
    );

    expect(header).toContain("search: /price_");
    expect(header).toContain("[1/3]");
    expect(header).toContain("Enter confirms");
    expect(header).toContain("Esc cancels");
  });

  it("shows confirmed document search state in the header", () => {
    const header = headerText(
      "",
      4,
      4,
      false,
      "normal",
      false,
      { active: false, query: "" },
      { active: true, query: "price", match: "2/3" },
    );

    expect(header).toContain("search: /price_");
    expect(header).toContain("[2/3]");
  });

  it("documents the CLI help command", () => {
    expect(cliHelpText()).toContain("mdui help");
    expect(cliHelpText()).toContain("8j");
    expect(cliHelpText()).toContain("y");
    expect(cliHelpText()).toContain("o or Enter");
    expect(cliHelpText()).toContain("Ctrl-/");
    expect(cliHelpText()).toContain("Ctrl-?");
    expect(cliHelpText()).toContain("Ctrl-u");
    expect(cliHelpText()).toContain("remote Markdown URL");
  });

  it("builds an in-app help panel with info and keybindings", () => {
    const help = helpPanelText();

    expect(help).toContain("MDUI Help");
    expect(help).toContain("Info");
    expect(help).toContain("Finder");
    expect(help).toContain("Document");
    expect(help).toContain("Ctrl-/");
    expect(help).toContain("Ctrl-?");
    expect(help).toContain("Ctrl-u");
    expect(help).toContain("remote Markdown URL");
    expect(help).toContain("Scroll this panel");
  });
});
