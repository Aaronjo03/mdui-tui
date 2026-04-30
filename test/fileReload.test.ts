import { describe, expect, it } from "vitest";
import { isStableFileSnapshot, shouldReloadFileByMtime } from "../src/tui/fileReload.js";

describe("file reload helpers", () => {
  it("reloads when there is no successful read timestamp yet", () => {
    expect(shouldReloadFileByMtime(100, undefined)).toBe(true);
  });

  it("reloads only when the file mtime is newer than the last read file mtime", () => {
    expect(shouldReloadFileByMtime(101, 100)).toBe(true);
    expect(shouldReloadFileByMtime(100, 100)).toBe(false);
    expect(shouldReloadFileByMtime(99, 100)).toBe(false);
  });

  it("treats a read snapshot as stable only when size and mtime match", () => {
    expect(isStableFileSnapshot({ mtimeMs: 100, size: 10 }, { mtimeMs: 100, size: 10 })).toBe(true);
    expect(isStableFileSnapshot({ mtimeMs: 100, size: 10 }, { mtimeMs: 101, size: 10 })).toBe(false);
    expect(isStableFileSnapshot({ mtimeMs: 100, size: 10 }, { mtimeMs: 100, size: 11 })).toBe(false);
  });
});
