import { describe, expect, it } from "vitest";
import { linkifyBareUrls } from "../src/markdown/linkifyUrls.js";

describe("linkifyBareUrls", () => {
  it("turns bare https URLs into markdown links", () => {
    expect(linkifyBareUrls("See https://example.com/docs for docs.")).toBe(
      "See [https://example.com/docs](https://example.com/docs) for docs.",
    );
  });

  it("adds https hrefs for www URLs", () => {
    expect(linkifyBareUrls("Open www.example.com now")).toBe("Open [www.example.com](https://www.example.com) now");
  });

  it("does not rewrite existing markdown links", () => {
    expect(linkifyBareUrls("[site](https://example.com)")).toBe("[site](https://example.com)");
  });

  it("does not rewrite URLs inside fenced code blocks", () => {
    const markdown = "```sh\ncurl https://example.com\n```";

    expect(linkifyBareUrls(markdown)).toBe(markdown);
  });
});
