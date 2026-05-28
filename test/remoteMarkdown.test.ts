import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchRemoteMarkdown,
  isRemoteMarkdownUrl,
  normalizeRemoteMarkdownUrl,
  resolveRemoteMarkdownUrl,
} from "../src/fs/remoteMarkdown.js";

describe("remote Markdown helpers", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of tempDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("detects and normalizes only http(s) Markdown URLs", () => {
    expect(isRemoteMarkdownUrl("https://telnyx.com/pricing.md")).toBe(true);
    expect(isRemoteMarkdownUrl("http://example.com/docs/readme.markdown?download=1")).toBe(true);
    expect(isRemoteMarkdownUrl("https://telnyx.com/pricing")).toBe(false);
    expect(isRemoteMarkdownUrl("file:///tmp/readme.md")).toBe(false);
    expect(normalizeRemoteMarkdownUrl("https://telnyx.com/pricing.md#plans")).toBe(
      "https://telnyx.com/pricing.md#plans",
    );
  });

  it("resolves relative remote Markdown links against a remote base URL", () => {
    expect(resolveRemoteMarkdownUrl("https://telnyx.com/docs/index.md", "pricing.md#sms")).toBe(
      "https://telnyx.com/docs/pricing.md",
    );
    expect(resolveRemoteMarkdownUrl("https://telnyx.com/docs/index.md", "../pricing.md")).toBe(
      "https://telnyx.com/pricing.md",
    );
    expect(resolveRemoteMarkdownUrl("https://telnyx.com/docs/index.md", "../pricing")).toBeUndefined();
  });

  it("fetches remote Markdown into a temp-backed MarkdownFile", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "mdui-remote-test-"));
    tempDirectories.push(tempDirectory);
    const document = await fetchRemoteMarkdown("https://telnyx.com/pricing.md", {
      tempDirectory,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      fetcher: async () => new Response("# Pricing\n", { status: 200, statusText: "OK" }),
    });

    expect(document.markdown).toBe("# Pricing\n");
    expect(document.sourceUrl).toBe("https://telnyx.com/pricing.md");
    expect(document.file.name).toBe("pricing.md");
    expect(document.file.relativePath).toBe("telnyx.com/pricing.md");
    expect(document.file.sizeBytes).toBe(new TextEncoder().encode("# Pricing\n").byteLength);
    await expect(readFile(document.file.absolutePath, "utf8")).resolves.toBe("# Pricing\n");
  });

  it("reports HTTP failures clearly", async () => {
    await expect(
      fetchRemoteMarkdown("https://telnyx.com/missing.md", {
        fetcher: async () => new Response("nope", { status: 404, statusText: "Not Found" }),
      }),
    ).rejects.toThrow("HTTP 404 Not Found");
  });

  it("rejects redirects away from Markdown URLs", async () => {
    const response = new Response("<html></html>", { status: 200, statusText: "OK" });
    Object.defineProperty(response, "url", { value: "https://telnyx.com/pricing", configurable: true });

    await expect(
      fetchRemoteMarkdown("https://telnyx.com/pricing.md", {
        fetcher: async () => response,
      }),
    ).rejects.toThrow("redirected away from a Markdown URL");
  });

  it("rejects HTML fallback responses for Markdown URLs", async () => {
    await expect(
      fetchRemoteMarkdown("https://telnyx.com/missing.md", {
        fetcher: async () =>
          new Response("<!doctype html><html><title>Missing</title></html>", {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      }),
    ).rejects.toThrow("response was HTML, not Markdown");
  });

  it("rejects sniffed HTML fallback responses without content-type", async () => {
    await expect(
      fetchRemoteMarkdown("https://telnyx.com/missing.md", {
        fetcher: async () => new Response("\n<html><title>Missing</title></html>", { status: 200, statusText: "OK" }),
      }),
    ).rejects.toThrow("response was HTML, not Markdown");
  });

  it("rejects oversized responses before writing temp files", async () => {
    await expect(
      fetchRemoteMarkdown("https://telnyx.com/pricing.md", {
        maxBytes: 4,
        fetcher: async () => new Response("# Pricing\n", { status: 200, statusText: "OK" }),
      }),
    ).rejects.toThrow("Remote Markdown is too large");
  });

  it("stops reading oversized chunked responses without buffering the full body", async () => {
    let reads = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new TextEncoder().encode("chunk"));
        if (reads > 10) {
          controller.close();
        }
      },
      cancel() {
        canceled = true;
      },
    });

    await expect(
      fetchRemoteMarkdown("https://telnyx.com/pricing.md", {
        maxBytes: 6,
        fetcher: async () => new Response(body, { status: 200, statusText: "OK" }),
      }),
    ).rejects.toThrow("Remote Markdown is too large");
    expect(reads).toBeLessThan(10);
    expect(canceled).toBe(true);
  });

  it("removes terminal control sequences from remote Markdown", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "mdui-remote-test-"));
    tempDirectories.push(tempDirectory);
    const document = await fetchRemoteMarkdown("https://telnyx.com/pricing.md", {
      tempDirectory,
      fetcher: async () =>
        new Response("# Safe\n\u001B]52;c;bad\u0007\u001B[31mred\u001B[0m\u009B31mc1\u009D52;c;bad\u009C\u0000", {
          status: 200,
          statusText: "OK",
        }),
    });

    expect(document.markdown).toBe("# Safe\nred");
    await expect(readFile(document.file.absolutePath, "utf8")).resolves.toBe("# Safe\nred");
  });

  it("normalizes carriage returns in remote Markdown", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "mdui-remote-test-"));
    tempDirectories.push(tempDirectory);
    const document = await fetchRemoteMarkdown("https://telnyx.com/pricing.md", {
      tempDirectory,
      fetcher: async () => new Response("# Safe\r\nnext\roverwrite", { status: 200, statusText: "OK" }),
    });

    expect(document.markdown).toBe("# Safe\nnextoverwrite");
  });
});
