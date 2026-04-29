import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

export interface MduiConfig {
  readonly includeHidden?: boolean;
  readonly maxDepth?: number;
  readonly ignoredDirectories?: readonly string[];
  readonly pdfOutputDirectory?: string;
}

export interface ConfigDiscoveryResult {
  readonly path: string | undefined;
  readonly config: MduiConfig;
}

const configFileNames = [".mduirc", ".mdui.json", "mdui.config.json"];

export async function discoverMduiConfig(startDirectory: string): Promise<ConfigDiscoveryResult> {
  const explicitConfig = process.env.MDUI_CONFIG;
  if (explicitConfig !== undefined && explicitConfig.length > 0) {
    return { path: explicitConfig, config: parseMduiConfig(JSON.parse(await readFile(explicitConfig, "utf8"))) };
  }

  for (const directory of parentDirectories(startDirectory)) {
    for (const name of configFileNames) {
      const path = join(directory, name);
      const config = await readConfigFile(path);
      if (config !== undefined) {
        return { path, config };
      }
    }
  }
  const userConfigPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mdui", "config.json");
  const userConfig = await readConfigFile(userConfigPath);
  if (userConfig !== undefined) {
    return { path: userConfigPath, config: userConfig };
  }
  return { path: undefined, config: {} };
}

export function parseMduiConfig(value: unknown): MduiConfig {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...(typeof value.includeHidden === "boolean" ? { includeHidden: value.includeHidden } : {}),
    ...(isSafeMaxDepth(value.maxDepth) ? { maxDepth: value.maxDepth } : {}),
    ...(isSafeStringArray(value.ignoredDirectories) ? { ignoredDirectories: value.ignoredDirectories } : {}),
    ...(isSafeString(value.pdfOutputDirectory) ? { pdfOutputDirectory: value.pdfOutputDirectory } : {}),
  };
}

async function readConfigFile(path: string): Promise<MduiConfig | undefined> {
  try {
    return parseMduiConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

function parentDirectories(startDirectory: string): readonly string[] {
  const directories: string[] = [];
  let current = startDirectory;
  const root = parse(startDirectory).root;
  while (true) {
    directories.push(current);
    if (current === root) {
      return directories;
    }
    current = dirname(current);
  }
}

function isSafeMaxDepth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 32;
}

function isSafeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length < 4096 && !value.includes("\u0000");
}

function isSafeStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isSafeString(entry) && !entry.includes("/") && !entry.includes("\\"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
