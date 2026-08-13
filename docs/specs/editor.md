# Editor

Live-preview markdown editing: syntax marks hide until the cursor touches them,
so you edit rendered text rather than a split pane. Tables, images, and task
lists render in place; `![](path)` and `![[embed]]` resolve against the vault.

Enter on a blank line at the tail of a fenced code block exits the block: a
closed fence drops the blank line and lands after the closing mark, an unclosed
fence turns the blank line into the closing mark. Without this an unclosed
fence runs to the end of the note and there is no way out of it. Fences nested
in quotes or lists are left to plain Enter.

Wikilinks `[[Note]]` and `[[Note|alias]]` navigate on click and create the note
if it doesn't exist. A new note names itself from its first `# heading` once the
cursor leaves that line — it never overwrites a chosen name or an existing file.

Autosave fires on idle and on ⌘S. Edits made outside the app (Obsidian,
Syncthing, git) are picked up when the window regains focus. An outline panel
tracks scroll position and jumps on click. Dark mode, word count, adjustable tab
size, Vesper theme.

# Tasks

- [x] EDIT-005 Exit a fenced code block with Enter on a blank tail line
  Enter inside a fence only adds code rows, and an unclosed fence runs to
  the end of the note, so an all-code note traps the cursor. On a blank
  line at the block's tail, Enter exits: a closed fence drops the blank
  line and lands after the closing fence; an unclosed fence turns the
  blank line into the closing fence.
