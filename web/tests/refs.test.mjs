// The web's share-link refs (src/real/refs.js) over a fake localStorage: kept per presale,
// sent with a join, dropped after it; storage that throws keeps nothing and breaks nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dropRef, noteRef, refFor, shareLink } from '../src/real/refs.js'

const KEY = 'K'.repeat(44)
const SHARER = 'S'.repeat(44)
const ME = 'M'.repeat(44)

function fakeStorage() {
  const m = new Map()
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) }
}

test("a link's ref is kept for its presale, sent with my join, then dropped", () => {
  const s = (globalThis.localStorage = fakeStorage())
  noteRef(KEY, SHARER)
  assert.equal(JSON.parse(s.m.get('mooner:refs'))[KEY].ref, SHARER)
  assert.equal(refFor(KEY, ME), SHARER)
  assert.equal(refFor(KEY, SHARER), null, 'never my own wallet')
  assert.equal(refFor('P'.repeat(44), ME), null, 'another presale')
  dropRef(KEY)
  assert.deepEqual(JSON.parse(s.m.get('mooner:refs')), {})
  assert.equal(refFor(KEY, ME), null)
})

test("my own link doesn't replace a friend's ref", () => {
  globalThis.localStorage = fakeStorage()
  noteRef(KEY, SHARER, ME)
  noteRef(KEY, ME, ME)
  assert.equal(refFor(KEY, ME), SHARER)
})

test('junk refs and a broken save change nothing', () => {
  const s = (globalThis.localStorage = fakeStorage())
  noteRef(KEY, 'not a wallet')
  assert.equal(s.m.has('mooner:refs'), false)
  s.m.set('mooner:refs', '{broken')
  assert.equal(refFor(KEY, ME), null)
  noteRef(KEY, SHARER)
  assert.equal(refFor(KEY, ME), SHARER, 'a broken save is replaced')
})

test('storage that throws (private mode): nothing kept, nothing thrown', () => {
  const boom = () => {
    throw new Error('denied')
  }
  globalThis.localStorage = { getItem: boom, setItem: boom }
  assert.doesNotThrow(() => noteRef(KEY, SHARER))
  assert.equal(refFor(KEY, ME), null)
  assert.doesNotThrow(() => dropRef(KEY))
})

test("the copied link carries my wallet; a guest's carries none", () => {
  assert.equal(shareLink('', KEY, ME), `/presale/${KEY}?ref=${ME}`)
  assert.equal(shareLink('', KEY, 'guest'), `/presale/${KEY}`)
})
