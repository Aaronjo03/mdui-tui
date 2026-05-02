import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/markdown/parseMarkdown.js";
import { stripAnsi, visibleLength } from "../src/render/ansi.js";
import { renderMarkdownToAnsi } from "../src/render/markdownToAnsi.js";

describe("markdown rendering", () => {
  it("renders headings, inline styles, links, and code blocks", () => {
    const markdown = `# Hello

This is **strong**, _emphasis_, \`code\`, and [OpenTUI](https://github.com/anomalyco/opentui).

\`\`\`sh
mdui README.md
\`\`\`
`;

    const output = stripAnsi(renderMarkdownToAnsi(markdown, { width: 80, color: false }));

    expect(output).toContain("# Hello");
    expect(output).toContain("This is strong, emphasis,  code , and OpenTUI");
    expect(output).toContain("(https://github.com/anomalyco/opentui).");
    expect(output).toContain("┌─ sh");
    expect(output).toContain("│ mdui README.md");
  });

  it("renders GFM-style tables with alignment-aware padding", () => {
    const markdown = `| Command | Status |
| --- | ---: |
| \`mdui\` | Ready |
| finder | Soon |`;

    const output = stripAnsi(renderMarkdownToAnsi(markdown, { width: 80, color: false }));

    expect(output).toContain("┌");
    expect(output).toContain("Command");
    expect(output).toContain("Status");
    expect(output).toContain("finder");
  });

  it("wraps wide table cells to the requested render width", () => {
    const markdown = `| Product | Description | Price |
| --- | --- | ---: |
| Messaging | A very long description that should wrap inside the table instead of pushing the cursor off screen | $0.0025 |
| Voice | SupercalifragilisticexpialidociousWithoutSpaces | $0.0100 |`;

    const output = stripAnsi(renderMarkdownToAnsi(markdown, { width: 44, color: false }));
    const lines = output.split("\n").filter((line) => line.length > 0);

    expect(lines.every((line) => visibleLength(line) <= 44)).toBe(true);
    expect(lines.filter((line) => line.startsWith("│")).length).toBeGreaterThan(4);
    expect(output).toContain("cursor off");
    expect(output).toContain("screen");
  });

  it("chunks long table words after existing cell content", () => {
    const markdown = `| A | B | C |
| --- | --- | --- |
| aa | aa SupercalifragilisticexpialidociousWithoutSpaces | aa |`;

    const output = stripAnsi(renderMarkdownToAnsi(markdown, { width: 24, color: false }));
    const lines = output.split("\n").filter((line) => line.length > 0);

    expect(lines.every((line) => visibleLength(line) <= 24)).toBe(true);
  });

  it("emits no ANSI escape sequences when color is disabled", () => {
    const output = renderMarkdownToAnsi("# Title\n\n**bold** and [link](https://example.com)", {
      width: 80,
      color: false,
    });

    expect(output).not.toContain("\u001B[");
  });

  it("parses block types in document order", () => {
    const document = parseMarkdown(`# Title

> Quote

- one
- two

---`);

    expect(document.blocks.map((block) => block.kind)).toEqual(["heading", "blockquote", "list", "rule"]);
  });
});
