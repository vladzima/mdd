# mdd

Browser-based local-first markdown editor for a folder of `.md` files (e.g. an Obsidian vault). Inspired by [writer-computer](https://github.com/joelbqz/writer-computer), but running entirely in the browser via the File System Access API — no server, nothing uploaded.

Requires a Chromium browser (Chrome, Edge, Arc, Brave); Firefox and Safari don't support `showDirectoryPicker()`.

## Features

- Open a local vault folder with read/write access; the grant persists across sessions (one-click re-confirm)
- File tree sidebar (resizable, persisted) with recent files, create, rename, delete; `.obsidian`, `.git` etc. ignored
- Live-preview editing: syntax marks hide until the cursor touches the element (Obsidian/writer.computer style)
- Rendered tables, inline images (`![](path)` and `![[embed]]`), clickable checkboxes, horizontal rules
- Wikilinks `[[Note]]` / `[[Note|alias]]` — click to navigate, creates the note if missing
- Outline panel with click-to-jump and scroll position tracking
- Autosave (800 ms idle) plus ⌘S; picks up external edits (Obsidian, sync) on window focus
- Word count, dark mode, ⌘\ toggles the sidebar, restores your last-open note

## Development

```
npm install
npm run dev
```

`npm run build` typechecks and bundles; `npm run lint` runs oxlint.
