import assert from 'node:assert'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { exitCodeBlock } from './codeBlock'

const run = (doc, pos) => {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [markdown({ base: markdownLanguage })],
  })
  let out = null
  const handled = exitCodeBlock({ state, dispatch: (tr) => (out = tr.state) })
  return { handled, doc: out?.doc.toString(), cursor: out?.selection.main.head }
}

// unclosed fence, blank last line: the blank line becomes the closing fence
let r = run('```\ncode\n', 9)
assert.equal(r.handled, true)
assert.equal(r.doc, '```\ncode\n```\n')
assert.equal(r.cursor, 13)

// opening fence marker is reused (~~~, info string)
r = run('~~~js\ncode\n', 11)
assert.equal(r.doc, '~~~js\ncode\n~~~\n')

// closed fence, blank line above the closing mark: blank line jumps out
r = run('```\ncode\n\n```', 9)
assert.equal(r.handled, true)
assert.equal(r.doc, '```\ncode\n```\n')
assert.equal(r.cursor, 13)

// closed fence mid-document: cursor lands at the start of the next line
r = run('```\ncode\n\n```\nafter', 9)
assert.equal(r.handled, true)
assert.equal(r.doc, '```\ncode\n```\n\nafter')
assert.equal(r.cursor, 13)

// blank line in the middle of a block: plain newline, not an exit
assert.equal(run('```\na\n\nb\n```', 6).handled, false)
// non-blank line: not handled
assert.equal(run('```\ncode\n```', 8).handled, false)
// blank line outside any fence: not handled
assert.equal(run('text\n\nmore', 5).handled, false)
// fence nested in a blockquote: leave alone
assert.equal(run('> ```\n> code\n', 13).handled, false)

console.log('codeBlock tests passed')
