#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isMarkdownPath } from "./fs/markdownFiles.js";
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
    await renderFile(options.filePath);
    return 0;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("mdui: interactive finder requires a TTY. Pass a Markdown file to render directly.\n");
    return 1;
  }

  await runTui({ rootDirectory: process.cwd() });
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
  const absolutePath = resolve(filePath);
  const source = await readFile(absolutePath, "utf8");
  if (!isMarkdownPath(filePath)) {
    process.stderr.write(`mdui: '${filePath}' does not look like Markdown; rendering as Markdown anyway.\n`);
  }
  const width = process.stdout.columns > 0 ? process.stdout.columns : 88;
  process.stdout.write(renderMarkdownToAnsi(source, { width, color: process.stdout.isTTY && process.env.NO_COLOR === undefined }));
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
