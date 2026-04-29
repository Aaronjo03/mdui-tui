# Command Notes

## Project setup

```sh
bun init
bun add @opentui/core
```

## A process table

| PID | Process | CPU |
| ---: | --- | ---: |
| 4312 | node | 12% |
| 9981 | bun test | 43% |
| 1112 | zsh | 1% |

## Nested checklist-style notes

- Renderer
  - Parse token stream
  - Wrap lines to viewport width
- Finder
  - Ignore `node_modules`
  - Prefer exact basename matches
