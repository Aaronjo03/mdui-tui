/// <reference types="bun-types" />

import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportMarkdownToPdf } from "../src/export/pdf.js";

describe("PDF export", () => {
  it("writes the rendered PDF to the requested output directory", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "mdui-export-test-"));
    const chromeStubPath = await createChromeStub(tempDirectory);

    try {
      const outputPath = await exportMarkdownToPdf("# PDF Export\n\n| A | B |\n| - | - |\n| 1 | 2 |\n", "notes.md", {
        outputDirectory: tempDirectory,
        chromeExecutable: chromeStubPath,
      });
      const bytes = new Uint8Array(await Bun.file(outputPath).arrayBuffer());

      expect(outputPath).toBe(join(tempDirectory, "notes.pdf"));
      expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("%PDF");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("removes images and unsafe links from rendered PDF HTML", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "mdui-export-test-"));
    const chromeStubPath = await createChromeStub(tempDirectory);

    try {
      const outputPath = await exportMarkdownToPdf(
        [
          "[safe](https://example.com/path?x=1&y=2)",
          "[script](javascript:alert(1))",
          "![remote pixel](https://tracker.example/pixel.png)",
          "![local file](file:///etc/passwd)",
        ].join("\n\n"),
        "links.md",
        {
          outputDirectory: tempDirectory,
          chromeExecutable: chromeStubPath,
        },
      );
      const documentUrl = await Bun.file(`${outputPath}.url`).text();
      const html = decodeDataUrlHtml(documentUrl);

      expect(html).toContain('href="https://example.com/path?x=1&amp;y=2"');
      expect(html).toContain("script");
      expect(html).toContain("[image removed: remote pixel]");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("tracker.example");
      expect(html).not.toContain("file://");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

async function createChromeStub(tempDirectory: string): Promise<string> {
  const chromeStubPath = join(tempDirectory, "chrome-stub.sh");
  await writeFile(
    chromeStubPath,
    `#!/bin/sh
output=""
last=""
for arg in "$@"; do
  case "$arg" in
    --print-to-pdf=*)
      output="\${arg#--print-to-pdf=}"
      printf '%%PDF-1.4\n' > "$output"
      ;;
    *)
      last="$arg"
      ;;
  esac
done
if [ -z "$output" ]; then
  exit 1
fi
printf '%s' "$last" > "$output.url"
case "$last" in
  data:text/html*) exit 0 ;;
  *) exit 1 ;;
esac
`,
    "utf8",
  );
  await chmod(chromeStubPath, 0o755);
  return chromeStubPath;
}

function decodeDataUrlHtml(documentUrl: string): string {
  const prefix = "data:text/html;charset=utf-8,";
  expect(documentUrl.startsWith(prefix)).toBe(true);
  return decodeURIComponent(documentUrl.slice(prefix.length));
}
