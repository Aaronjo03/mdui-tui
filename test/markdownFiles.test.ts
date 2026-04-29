/// <reference types="node" />
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { discoverMarkdownFiles, isMarkdownPath, type DirectoryEntry, type FileStat, type MarkdownFileSystem } from "../src/fs/markdownFiles.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("markdown file discovery", () => {
  it("detects supported markdown extensions", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
    expect(isMarkdownPath("script.ts")).toBe(false);
  });

  it("discovers markdown files while skipping ignored directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdui-"));
    tempRoots.push(root);
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "README.md"), "# Readme");
    await writeFile(join(root, "docs", "guide.markdown"), "# Guide");
    await writeFile(join(root, "node_modules", "ignored.md"), "# Ignored");

    const files = await discoverMarkdownFiles({ rootDirectory: root });

    expect(files.map((file) => file.relativePath).sort()).toEqual(["README.md", join("docs", "guide.markdown")].sort());
  });

  it("skips unreadable directories and missing files without aborting discovery", async () => {
    const root = "/workspace";
    const stats = makeStats();
    const fileSystem: MarkdownFileSystem = {
      async readdir(path) {
        if (path === root) {
          return [dirEntry("blocked"), fileEntry("README.md"), fileEntry("gone.md")];
        }
        if (path === join(root, "blocked")) {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        }
        return [];
      },
      async stat(path) {
        if (path === join(root, "gone.md")) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return stats;
      },
    };

    const files = await discoverMarkdownFiles({ rootDirectory: root, fileSystem });

    expect(files.map((file) => file.relativePath)).toEqual(["README.md"]);
  });
});

function fileEntry(name: string): DirectoryEntry {
  return {
    name,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
  };
}

function dirEntry(name: string): DirectoryEntry {
  return {
    name,
    isSymbolicLink: () => false,
    isDirectory: () => true,
    isFile: () => false,
  };
}

function makeStats(): FileStat {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    size: 128,
    mtime: now,
  };
}
