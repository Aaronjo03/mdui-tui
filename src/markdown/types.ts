export type InlineSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "emphasis"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type TableAlignment = "left" | "center" | "right";

export type MarkdownBlock =
  | { readonly kind: "heading"; readonly depth: 1 | 2 | 3 | 4 | 5 | 6; readonly content: readonly InlineSegment[] }
  | { readonly kind: "paragraph"; readonly content: readonly InlineSegment[] }
  | { readonly kind: "blockquote"; readonly content: readonly InlineSegment[] }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly InlineSegment[])[] }
  | { readonly kind: "code"; readonly language: string | undefined; readonly code: string }
  | {
      readonly kind: "table";
      readonly headers: readonly string[];
      readonly alignments: readonly TableAlignment[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly kind: "rule" };

export interface MarkdownDocument {
  readonly blocks: readonly MarkdownBlock[];
}
