# Changelog

All notable changes to MDUI are documented here.

## Unreleased

### Added

- Added cached document search matches with visible highlights and `n`/`N`/`p` repeat navigation.
- Added `42G`-style line jumps, a table-of-contents overlay, footer word count/reading time, and current-file reloads.
- Added internal Markdown navigation for relative `.md` links and `[[wikilinks]]`, including mouse activation and `Ctrl-o`/`Ctrl-i` history.
- Added JSON configuration discovery via `MDUI_CONFIG`, `.mduirc`, `.mdui.json`, `mdui.config.json`, and XDG user config.
- Added native clipboard fallbacks for macOS, Linux, and Windows after OSC52 copying.

### Changed

- PDF export now lets Marked parse raw Markdown directly and sanitizes raw HTML in the renderer instead of pre-escaping Markdown text.
- Markdown discovery can now skip additional configured directory names.
- README and samples now document the expanded TUI controls and configuration surface.

## 0.1.1 - 2026-04-29

### Fixed

- Skipped `ETIMEDOUT` filesystem errors during Markdown discovery so network-mounted directories do not abort scanning.
- Cleaned up npm binary metadata and package versioning for the `mdui`/`MDUI` CLI aliases.

## 0.1.0 - 2026-04-29

### Added

- Introduced the Bun/OpenTUI MDUI application with an interactive Markdown finder and direct file rendering.
- Added read-only Vim-style navigation, visual and visual-block selection, line numbers, link opening, Slack copy, PDF export, and in-app help.
- Added Markdown rendering support for headings, paragraphs, links, lists, blockquotes, code fences, tables, and rules.
