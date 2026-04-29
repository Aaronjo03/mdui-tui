import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/markdown/parseMarkdown.js";
import { stripAnsi } from "../src/render/ansi.js";
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

  it("emits no ANSI escape sequences when color is disabled", () => {
    const output = renderMarkdownToAnsi("# Title\n\n**bold** and [link](https://example.com)", { width: 80, color: false });

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
