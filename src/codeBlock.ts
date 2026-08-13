// Enter inside a fence only adds code rows, and an unclosed fence swallows the
// rest of the note. On a blank line at the block's tail, Enter exits instead:
// a closed fence drops the blank line and lands after the closing fence; an
// unclosed fence turns the blank line into the closing fence.

import { syntaxTree } from '@codemirror/language'
import type { StateCommand } from '@codemirror/state'

export const exitCodeBlock: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (line.text.trim() !== '') return false
  const resolved = syntaxTree(state).resolveInner(sel.head, -1)
  const block = resolved.name === 'FencedCode' ? resolved : resolved.parent
  if (!block || block.name !== 'FencedCode') return false
  // nested in a quote or list: closing it needs the container's prefix, leave alone
  if (state.doc.lineAt(block.from).from !== block.from) return false
  const marks = block.getChildren('CodeMark')
  if (marks.length > 1) {
    // closed fence: only exit from the blank line directly above the closing mark
    if (state.doc.lineAt(marks[marks.length - 1].from).number !== line.number + 1) return false
    dispatch(
      state.update({
        // the blank line jumps out of the block
        changes: [
          { from: line.from - 1, to: line.to },
          { from: block.to, insert: '\n' },
        ],
        selection: { anchor: block.to - (line.to - line.from + 1) + 1 },
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
  } else {
    // unclosed fence: the blank line becomes the closing fence
    if (line.to !== block.to) return false
    const fence = state.doc.sliceString(marks[0].from, marks[0].to)
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: fence + '\n' },
        selection: { anchor: line.from + fence.length + 1 },
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
  }
  return true
}
