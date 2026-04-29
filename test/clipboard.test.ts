import { describe, expect, it } from "vitest";
import { createOsc52Sequence, nativeClipboardCommands } from "../src/tui/clipboard.js";

describe("OSC52 clipboard sequences", () => {
  it("creates a clipboard OSC52 sequence", () => {
    expect(createOsc52Sequence("hello", {})).toBe("\u001B]52;c;aGVsbG8=\u0007");
  });

  it("wraps OSC52 for tmux passthrough", () => {
    expect(createOsc52Sequence("hello", { TMUX: "/tmp/tmux" })).toBe("\u001BPtmux;\u001B\u001B]52;c;aGVsbG8=\u0007\u001B\\");
  });

  it("uses native clipboard commands that accept stdin rather than argv text", () => {
    expect(nativeClipboardCommands("darwin")).toEqual([{ executable: "pbcopy", args: [] }]);
    expect(nativeClipboardCommands("linux").every((command) => !command.args.includes("hello"))).toBe(true);
  });
});
