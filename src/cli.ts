#!/usr/bin/env bun
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverMduiConfig } from "./config/config.js";
import { isMarkdownPath } from "./fs/markdownFiles.js";
import { fetchRemoteMarkdown, isRemoteMarkdownUrl } from "./fs/remoteMarkdown.js";
import { renderMarkdownToAnsi } from "./render/markdownToAnsi.js";
import { runTui } from "./tui/runTui.js";
import { cliHelpText } from "./tui/text.js";

interface CliOptions {
  readonly filePath: string | undefined;
  readonly help: boolean;
}

async function main(args: readonly string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(cliHelpText());
    return 0;
  }

  if (options.filePath !== undefined) {
    if (isHttpUrl(options.filePath) && process.stdin.isTTY && process.stdout.isTTY) {
      const config = await discoverMduiConfig(process.cwd());
      const remote = await fetchRemoteMarkdown(options.filePath);
      await runTui({ rootDirectory: process.cwd(), initialRemoteDocument: remote, ...config.config });
      return 0;
    }
    await renderFile(options.filePath);
    return 0;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "mdui: interactive finder requires a TTY. Pass a Markdown file or remote .md URL to render directly.\n",
    );
    return 1;
  }

  const config = await discoverMduiConfig(process.cwd());
  await runTui({ rootDirectory: process.cwd(), ...config.config });
  return 0;
}

function parseArgs(args: readonly string[]): CliOptions {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const helpCommand = positional[0] === "help";
  return {
    filePath: helpCommand ? undefined : positional[0],
    help: helpCommand || args.includes("--help") || args.includes("-h"),
  };
}

async function renderFile(filePath: string): Promise<void> {
  if (isHttpUrl(filePath)) {
    await renderRemoteFile(filePath);
    return;
  }

  const absolutePath = resolve(filePath);
  const source = await readFile(absolutePath, "utf8");
  if (!isMarkdownPath(filePath)) {
    process.stderr.write(`mdui: '${filePath}' does not look like Markdown; rendering as Markdown anyway.\n`);
  }
  const width = process.stdout.columns > 0 ? process.stdout.columns : 88;
  process.stdout.write(
    renderMarkdownToAnsi(source, { width, color: process.stdout.isTTY && process.env.NO_COLOR === undefined }),
  );
}

async function renderRemoteFile(url: string): Promise<void> {
  if (!isRemoteMarkdownUrl(url)) {
    throw new Error("remote URLs must point to a Markdown file");
  }
  const remote = await fetchRemoteMarkdown(url);
  try {
    const width = process.stdout.columns > 0 ? process.stdout.columns : 88;
    process.stdout.write(
      renderMarkdownToAnsi(remote.markdown, {
        width,
        color: process.stdout.isTTY && process.env.NO_COLOR === undefined,
      }),
    );
  } finally {
    await rm(remote.tempDirectory, { recursive: true, force: true });
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mdui: ${message}\n`);
    process.exitCode = 1;
  });
