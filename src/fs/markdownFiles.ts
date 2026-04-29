import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

export interface MarkdownFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
}

export interface DiscoverOptions {
  readonly rootDirectory: string;
  readonly includeHidden?: boolean;
  readonly maxDepth?: number;
  readonly fileSystem?: MarkdownFileSystem;
}

export interface DirectoryEntry {
  readonly name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface MarkdownFileSystem {
  readdir(path: string): Promise<readonly DirectoryEntry[]>;
  stat(path: string): Promise<FileStat>;
}

export interface FileStat {
  readonly mtime: Date;
  readonly size: number;
}

const markdownExtensions = new Set([".md", ".markdown", ".mdown", ".mkdn", ".mkd"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".turbo"]);
const defaultFileSystem: MarkdownFileSystem = {
  readdir: (path) => readdir(path, { withFileTypes: true }),
  stat,
};

export function isMarkdownPath(path: string): boolean {
  return markdownExtensions.has(extname(path).toLowerCase());
}

export async function discoverMarkdownFiles(options: DiscoverOptions): Promise<readonly MarkdownFile[]> {
  const maxDepth = options.maxDepth ?? 8;
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const files: MarkdownFile[] = [];
  await walk(options.rootDirectory, options.rootDirectory, files, { includeHidden: options.includeHidden ?? false, maxDepth }, fileSystem, 0);
  return files.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());
}

async function walk(
  rootDirectory: string,
  currentDirectory: string,
  files: MarkdownFile[],
  options: Required<Pick<DiscoverOptions, "includeHidden" | "maxDepth">>,
  fileSystem: MarkdownFileSystem,
  depth: number,
): Promise<void> {
  if (depth > options.maxDepth) {
    return;
  }

  const entries = await readDirectoryOrSkip(fileSystem, currentDirectory);
  await Promise.all(
    entries.map(async (entry) => {
      if (shouldIgnore(entry.name, options.includeHidden)) {
        return;
      }

      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        return;
      }

      if (entry.isDirectory()) {
        await walk(rootDirectory, absolutePath, files, options, fileSystem, depth + 1);
        return;
      }

      if (!entry.isFile() || !isMarkdownPath(entry.name)) {
        return;
      }

      const info = await statFileOrSkip(fileSystem, absolutePath);
      if (info === undefined) {
        return;
      }
      files.push({
        absolutePath,
        relativePath: relative(rootDirectory, absolutePath),
        name: basename(absolutePath),
        modifiedAt: info.mtime,
        sizeBytes: info.size,
      });
    }),
  );
}

async function readDirectoryOrSkip(fileSystem: MarkdownFileSystem, path: string): Promise<readonly DirectoryEntry[]> {
  try {
    return await fileSystem.readdir(path);
  } catch (error) {
    if (isSkippableFileSystemError(error)) {
      return [];
    }
    throw error;
  }
}

async function statFileOrSkip(fileSystem: MarkdownFileSystem, path: string): Promise<FileStat | undefined> {
  try {
    return await fileSystem.stat(path);
  } catch (error) {
    if (isSkippableFileSystemError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function isSkippableFileSystemError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = error.code;
  return code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "ENOTDIR";
}

function shouldIgnore(name: string, includeHidden: boolean): boolean {
  if (ignoredDirectories.has(name)) {
    return true;
  }
  return !includeHidden && name.startsWith(".");
}
