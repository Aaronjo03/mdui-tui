import { describe, expect, it } from "vitest";
import { cliHelpText, footerText, helpPanelText } from "../src/tui/text.js";

describe("TUI text helpers", () => {
  it("includes compact help by default", () => {
    expect(footerText("")).toContain("arrows/hjkl move");
    expect(footerText("")).toContain("Tab/Esc sidebar");
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

  it("shows cursor and document search state", () => {
    const footer = footerText("", { vimMode: "normal", sidebarVisible: false, cursorLine: 4, cursorColumn: 2, searchQuery: "table" });

    expect(footer).toContain("4:2");
    expect(footer).toContain("/table_");
  });

  it("shows count prefix state", () => {
    expect(footerText("", { vimMode: "normal", countPrefix: "8" })).toContain("count 8");
  });

  it("shows Slack copy and PDF export in help panel, not footer", () => {
    const help = helpPanelText();
    expect(help).toContain("Ctrl-y");
    expect(help).toContain("Ctrl-p");
    expect(help).toContain("Ctrl-/");
    expect(footerText("")).not.toContain("Ctrl-y Slack");
    expect(footerText("")).not.toContain("Ctrl-p PDF");
  });

  it("appends copy notifications", () => {
    expect(footerText("Copied to clipboard")).toContain("Copied to clipboard");
  });

  it("documents the CLI help command", () => {
    expect(cliHelpText()).toContain("mdui help");
    expect(cliHelpText()).toContain("8j");
    expect(cliHelpText()).toContain("y");
    expect(cliHelpText()).toContain("o or Enter");
    expect(cliHelpText()).toContain("Ctrl-/");
    expect(cliHelpText()).toContain("Ctrl-?");
  });

  it("builds an in-app help panel with info and keybindings", () => {
    const help = helpPanelText();

    expect(help).toContain("MDUI Help");
    expect(help).toContain("Info");
    expect(help).toContain("Finder");
    expect(help).toContain("Document");
    expect(help).toContain("Ctrl-/");
    expect(help).toContain("Ctrl-?");
    expect(help).toContain("Scroll this panel");
  });
});
