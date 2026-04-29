import { spawnSync } from "node:child_process";

export function createOsc52Sequence(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const payload = Buffer.from(text).toString("base64");
  const sequence = `\u001B]52;c;${payload}\u0007`;
  return env.TMUX !== undefined || env.STY !== undefined ? `\u001BPtmux;\u001B${sequence}\u001B\\` : sequence;
}

export function copyToClipboard(text: string): boolean {
  const osc52Copied = copyWithOsc52(text);
  return osc52Copied || copyWithNativeClipboard(text);
}

export function copyWithOsc52(text: string): boolean {
  if (!process.stdout.isTTY) {
    return false;
  }
  try {
    process.stdout.write(createOsc52Sequence(text));
    return true;
  } catch {
    return false;
  }
}

export interface ClipboardCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export function nativeClipboardCommands(platform: NodeJS.Platform = process.platform): readonly ClipboardCommand[] {
  switch (platform) {
    case "darwin":
      return [{ executable: "pbcopy", args: [] }];
    case "win32":
      return [{ executable: "clip.exe", args: [] }];
    case "linux":
      return [
        { executable: "wl-copy", args: [] },
        { executable: "xclip", args: ["-selection", "clipboard"] },
        { executable: "xsel", args: ["--clipboard", "--input"] },
      ];
    default:
      return [];
  }
}

export function copyWithNativeClipboard(text: string, commands: readonly ClipboardCommand[] = nativeClipboardCommands()): boolean {
  for (const command of commands) {
    const result = spawnSync(command.executable, command.args, {
      input: text,
      encoding: "utf8",
      shell: false,
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 5000,
    });
    if (result.status === 0 && result.error === undefined) {
      return true;
    }
  }
  return false;
}
