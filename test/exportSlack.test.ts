import { describe, expect, it } from "vitest";
import { markdownToSlackMrkdwn } from "../src/export/slack.js";

describe("Slack mrkdwn export", () => {
  it("converts Markdown headings, links, and emphasis to Slack-friendly mrkdwn", () => {
    const converted = markdownToSlackMrkdwn("# Release notes\n\n**Ship it** with [MDUI](https://example.com).\n");

    expect(converted).toContain("*Release notes*");
    expect(converted).toContain("*Ship it*");
    expect(converted).toContain("<https://example.com|MDUI>");
    expect(converted.endsWith("\n")).toBe(false);
  });
});
