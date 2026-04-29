# MDUI

MDUI is a Bun-powered terminal Markdown renderer built with strict TypeScript and OpenTUI. It opens a fast Markdown finder for a directory, renders documents in a read-only TUI, and adds vim-style navigation, search highlighting, visual selection, Slack/PDF export, line numbers, internal Markdown links, and compact in-app overlays.

> OpenTUI currently targets Bun, so MDUI runs on Bun rather than Node.

## Features

- Interactive Markdown finder rooted at the current directory.
- Rich OpenTUI Markdown rendering with full-width grid tables and OSC-8 terminal hyperlinks.
- Read-only vim-style navigation with counts (`8j`, `4k`, `42G`), `gg`/`G`, visual and visual-block selection.
- Document search with cached matches, visible match highlights, and `n`/`N` repeat navigation.
- Table-of-contents overlay plus footer word count and reading-time estimates.
- Internal Markdown navigation for relative `.md` links and `[[wikilinks]]`, with session back/forward history.
- Visual-only line numbers that are excluded from copied content.
- Clipboard helpers: copy selection/document through OSC52 with native clipboard fallbacks, copy Slack mrkdwn, and export PDF to `~/Downloads`.
- `mdui help` and `Ctrl-/` / `Ctrl-?` in-app help.

## Install from source

```sh
git clone https://github.com/Aaronjo03/mdui-tui.git
cd mdui-tui
bun install
bun run build
```

Run from the checkout:

```sh
bun run src/cli.ts README.md
bun run src/cli.ts
bun run src/cli.ts help
```

Or link the built CLI locally:

```sh
ln -sf "$PWD/dist/cli.js" ~/.local/bin/mdui
ln -sf "$PWD/dist/cli.js" ~/.local/bin/MDUI
```

## Usage

- `mdui <file.md>` renders a Markdown file directly.
- `mdui` opens an interactive Markdown finder rooted at the current directory.
- `mdui help` prints CLI and in-app keybinding help.

After `bun run build`, the compiled binary entry is `dist/cli.js`. Chrome/Chromium/Edge is required for PDF export.

## Keybindings

### Finder

| Key | Action |
| --- | --- |
| `j`/`k` or `↓`/`↑` | Move file selection |
| `/` | Filter Markdown files |
| `Backspace` | Remove filter character |
| `Enter` | Open selected Markdown file |
| `q` or `Ctrl-C` | Quit |

### Document view

| Key | Action |
| --- | --- |
| arrows or `h`/`j`/`k`/`l` | Move the read-only cursor |
| `8j`, `4k`, `5l` | Prefix motions with a Vim-style count |
| `0` | Move to the start of the current line |
| `Ctrl-d` / `Ctrl-u` | Scroll half a page |
| `Ctrl-f` / `Ctrl-b` | Scroll a page |
| `gg` / `G` / `42G` | Jump to top / bottom / line 42 |
| `Tab` | Toggle the file sidebar |
| `Esc` | Clear search, exit visual mode, or reopen the sidebar |
| `/` | Search document when fullscreen; filter files when the sidebar is visible |
| `Enter` while searching | Confirm the current document search |
| `n` | Move to the next search match |
| `N` or `p` | Move to the previous search match |
| `t` | Toggle the table-of-contents overlay |
| `v` / `Ctrl-v` | Start visual / visual-block selection |
| `y` | Yank visual / visual-block selection and clear the highlight |
| `c` | Copy highlighted text, or the whole document when nothing is highlighted |
| `o` or `Enter` | Open the first link on the current line; relative Markdown links and `[[wikilinks]]` open inside MDUI |
| mouse click on a link line | Open the clicked-line link with the same internal/external routing |
| `Ctrl-o` / `Ctrl-i` | Navigate back / forward through internal Markdown links |
| `Ctrl-y` | Copy the current document as Slack mrkdwn |
| `Ctrl-p` | Export the current document to `~/Downloads/<filename>.pdf` |
| `Ctrl-/` or `Ctrl-?` | Toggle the in-app help panel |

MDUI remembers the cursor line and scroll position per file for the current session only, watches the current file for changes, and reloads it in place. Line numbers are visual-only and are not part of copied Markdown content.

## Configuration

Interactive mode loads JSON configuration from the first matching source:

1. `MDUI_CONFIG=/path/to/config.json`
2. `.mduirc`, `.mdui.json`, or `mdui.config.json` in the current directory or a parent directory
3. `$XDG_CONFIG_HOME/mdui/config.json` (or `~/.config/mdui/config.json`)

Supported options are data-only settings:

```json
{
  "includeHidden": false,
  "maxDepth": 8,
  "ignoredDirectories": ["vendor", "tmp-notes"],
  "pdfOutputDirectory": "/Users/me/Downloads"
}
```

Config files cannot define shell commands or keybindings. Clipboard fallbacks are fixed platform commands (`pbcopy`, `wl-copy`, `xclip`, `xsel`, or `clip.exe`) and receive copied text on stdin.

## Development

```sh
bun install
bun "node_modules/typescript/bin/tsc" --noEmit -p tsconfig.test.json
bun run test
bun "node_modules/typescript/bin/tsc" -p tsconfig.json
```

## npm publishing prep

The package is named `mdui-tui` and exposes `mdui` / `MDUI` binaries from `dist/cli.js`. `dist/` is intentionally ignored in git; the `prepack` script builds it before packaging.

## License

MIT © Aaron Johnson

## Samples

- `samples/feature-tour.md` exercises headings, tables, lists, links, blockquotes, and command-output code fences.
- `samples/commands.md` focuses on terminal-command notes and process-table rendering.
