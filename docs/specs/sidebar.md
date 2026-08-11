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
global). Search results carry no pin toggle; pinning happens in the tree. A
pinned note is not repeated under Recent — the slot goes to a note without
one-tap access — and resurfaces there once unpinned, if still fresh. The tree
always lists every note regardless: shortcuts index it, they never replace it.

Row actions (pin, rename, delete; folders add create-note and create-folder)
overlay the right edge of the row they belong to instead of reserving width, so
an unhovered name runs the full row. The cluster matches the row's background —
hover, active, or plain — with a short gradient fade over the end of the name.
Hover, keyboard focus, or being the active note reveals it; it hides while a
drag is live or the row is renaming. On touch it stays visible.

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

- [x] SIDE-003 Row actions overlay the row instead of reserving space
  The hover buttons (rename, delete, pin) sit in the row's flex layout, so they
  reserve width on the right and truncate note names even though they're only
  visible on hover. Instead, absolutely position the action cluster over the
  right edge of the hovered row: same background as the hovered row, with a
  short gradient fade on its left side so it can partially cover the end of the
  name without a hard edge. The name gets the full row width when the pointer
  is elsewhere. Applies to file rows, folder rows, and the Recent/Pinned
  sections (shared FileRow).
  - Visibility is driven by .row:hover, .row:focus-within, and .row.active
    (src/index.css ~479–493) — the overlay background must match whichever
    state is behind it (hover bg vs active bg, per theme), and keyboard focus
    must still reveal the actions.
  - Touch has no hover: .row.active .row-action keeps actions reachable on the
    active row today — preserve that.
  - Pure presentation, no new tests needed; verify visually — truncated names
    get their full width back whenever the pointer is elsewhere.
  - Independent of SIDE-001, but SIDE-001's pin button adds a third action,
    making the reserved-width problem worse — do this soon after; no
    @blocked_by.

  **Implemented:**
  - Action buttons overlay the row's right edge; names get the full width until
    the actions are revealed
  - Overlay matches the hover/active/plain row background per theme, with a
    gradient fade over the name's end
  - Keyboard focus and the active row still reveal actions; touch keeps them
    always on
  - Actions hide during a drag and while a row is being renamed

- [x] SIDE-004 Pinned notes don't repeat under Recent
  A note that is pinned already has one-tap access in the Pinned section, so
  also listing it under Recent spends one of the five slots on a duplicate and
  can show the same note three times near the top of the sidebar. Filter pinned
  notes out of the Recent display; the tree stays complete. Display-only —
  unpinning lets the note reappear in Recent if it is still among the last
  opened.

  **Implemented:**
  - Recent skips notes that are currently pinned; the freed slot shows the next
    most recent note
  - Unpinning brings the note back to Recent if it is still fresh
  - The tree is untouched — it always lists every note
