# Sidebar

File tree with folders: create, rename, delete (empty folders only, so a folder
never takes notes down with it). Notes move by drag — onto a folder, or into the
space below the tree to return to root; works with mouse and touch (press and
hold, so a swipe still scrolls).

Sort by name, date edited, or manually — dragged order sticks. Recent keeps its
own order either way. Search (⌘K) covers names and note text with the matching
line shown beside each hit; names answer as you type, the text scan follows and
caches. Keyboard: one tab stop for the tree, arrows to move, left/right to open
and shut folders, Enter to open.

Every note row carries a pin toggle; pinned notes sit in their own section above
Recent. Dragging within the section reorders it — pins keep that order whatever
the sort mode — and each vault remembers its own list (Recent, by contrast, is
global). Search results carry no pin toggle; pinning happens in the tree.

# Tasks

- [x] SIDE-001 Pinned notes in the sidebar !high
  Let a note be pinned and unpinned from the tree. Pinned notes appear in their
  own section above Recent, keep a manual order, and persist per vault.

  **Implemented:**
  - Pin/unpin toggle on every note row; pinned notes listed in a Pinned section
    above Recent
  - Drag within the section reorders it, in every sort mode, mouse and touch
  - Pins persist per vault and follow renames, moves, and deletes
  - Fixed manual sort dropping a note onto itself sending it to the end
