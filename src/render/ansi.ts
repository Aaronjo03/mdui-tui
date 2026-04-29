export const ansi = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  italic: "\u001B[3m",
  underline: "\u001B[4m",
  cyan: "\u001B[36m",
  green: "\u001B[32m",
  magenta: "\u001B[35m",
  yellow: "\u001B[33m",
  gray: "\u001B[90m",
  inverse: "\u001B[7m",
} as const;

const ansiPattern = new RegExp("\\u001B\\[[0-9;]*m", "g");

export function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

export function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).length;
}

export function paint(value: string, ...styles: readonly string[]): string {
  if (styles.length === 0 || value.length === 0) {
    return value;
  }
  return `${styles.join("")}${value}${ansi.reset}`;
}
