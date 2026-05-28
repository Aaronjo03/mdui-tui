import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import * as z from "zod";

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

interface ParsedMduiConfig {
  includeHidden?: boolean;
  maxDepth?: number;
  ignoredDirectories?: readonly string[];
  pdfOutputDirectory?: string;
}

const configFileNames = [".mduirc", ".mdui.json", "mdui.config.json"];

const safeStringSchema = z
  .string()
  .min(1)
  .max(4095)
  .refine((value) => !value.includes("\u0000"));

const configFieldSchemas = {
  includeHidden: z.boolean(),
  maxDepth: z.number().int().min(0).max(32),
  ignoredDirectories: z.array(safeStringSchema.refine((value) => !value.includes("/") && !value.includes("\\"))),
  pdfOutputDirectory: safeStringSchema,
};

const configRecordSchema = z.record(z.string(), z.unknown());

export const mduiConfigSchema = z.strictObject({
  includeHidden: configFieldSchemas.includeHidden.optional(),
  maxDepth: configFieldSchemas.maxDepth.optional(),
  ignoredDirectories: configFieldSchemas.ignoredDirectories.optional(),
  pdfOutputDirectory: configFieldSchemas.pdfOutputDirectory.optional(),
});

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
  const recordResult = configRecordSchema.safeParse(value);
  if (!recordResult.success) {
    return {};
  }

  const config: ParsedMduiConfig = {};
  const valueRecord = recordResult.data;
  const includeHidden = configFieldSchemas.includeHidden.safeParse(valueRecord.includeHidden);
  if (includeHidden.success) {
    config.includeHidden = includeHidden.data;
  }
  const maxDepth = configFieldSchemas.maxDepth.safeParse(valueRecord.maxDepth);
  if (maxDepth.success) {
    config.maxDepth = maxDepth.data;
  }
  const ignoredDirectories = configFieldSchemas.ignoredDirectories.safeParse(valueRecord.ignoredDirectories);
  if (ignoredDirectories.success) {
    config.ignoredDirectories = ignoredDirectories.data;
  }
  const pdfOutputDirectory = configFieldSchemas.pdfOutputDirectory.safeParse(valueRecord.pdfOutputDirectory);
  if (pdfOutputDirectory.success) {
    config.pdfOutputDirectory = pdfOutputDirectory.data;
  }
  return config;
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

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
