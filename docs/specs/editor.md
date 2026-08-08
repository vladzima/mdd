# Editor

Live-preview markdown editing: syntax marks hide until the cursor touches them,
so you edit rendered text rather than a split pane. Tables, images, and task
lists render in place; `![](path)` and `![[embed]]` resolve against the vault.

Wikilinks `[[Note]]` and `[[Note|alias]]` navigate on click and create the note
if it doesn't exist. A new note names itself from its first `# heading` once the
cursor leaves that line — it never overwrites a chosen name or an existing file.

Autosave fires on idle and on ⌘S. Edits made outside the app (Obsidian,
Syncthing, git) are picked up when the window regains focus. An outline panel
tracks scroll position and jumps on click. Dark mode, word count, adjustable tab
size, Vesper theme.

# Tasks
