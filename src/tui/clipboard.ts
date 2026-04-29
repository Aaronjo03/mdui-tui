export function createOsc52Sequence(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const payload = Buffer.from(text).toString("base64");
  const sequence = `\u001B]52;c;${payload}\u0007`;
  return env.TMUX !== undefined || env.STY !== undefined ? `\u001BPtmux;\u001B${sequence}\u001B\\` : sequence;
}

export function copyToClipboard(text: string): boolean {
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
