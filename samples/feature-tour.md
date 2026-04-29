# MDUI Feature Tour

MDUI renders Markdown in the terminal with a small, predictable feature set.

## Tables

| Command | Description | Status |
| --- | --- | --- |
| `mdui README.md` | Render one file directly | Ready |
| `mdui` | Open the Markdown finder | Ready |
| `/` | Focus filter input in finder mode | Planned |

## Lists

- Headings
- Paragraphs with **strong** and _emphasis_
- Inline `code` spans
- Links like [OpenTUI](https://github.com/anomalyco/opentui)

1. Parse Markdown
2. Convert tokens to render lines
3. Paint through OpenTUI

## Command Output

```sh
$ bun run typecheck
> mdui@0.1.0 typecheck
> tsc --noEmit
```

> Blockquotes should stand out without taking over the whole screen.

---

Long enough documents can scroll one rendered line at a time.
