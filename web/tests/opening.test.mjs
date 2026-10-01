// The open the site couldn't tell went through (web/src/real/opening.js): the record kept
// per wallet, and what a failure, the read before a retry and a push mean for it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { afterFailedOpen, checkBeforeRetry, clearOpening, openingKey, readOpening, saveOpening, shows } from '../src/real/opening.js'

const WALLET = '7'.repeat(43)
const OTHER = '8'.repeat(43)
const PID = '9'.repeat(43)
const COIN = { mint: 'M'.repeat(43), presale: 'P'.repeat(44), symbol: 'MCAT', commit: 300_000_000 }

/** localStorage as a Map; `broken` makes every call throw (private mode). */
function storage(entries = {}, broken = false) {
  const m = new Map(Object.entries(entries))
  const s = {
    m,
    getItem: (k) => (broken ? fail() : (m.get(k) ?? null)),
    setItem: (k, v) => (broken ? fail() : void m.set(k, String(v))),
    removeItem: (k) => (broken ? fail() : void m.delete(k)),
  }
  return () => s
}
const fail = () => {
  throw new Error('SecurityError')
}
const stored = (record) => storage({ [openingKey(WALLET)]: JSON.stringify(record) })

test('the record is kept per wallet', () => {
  assert.equal(openingKey(WALLET), `mooner:opening:${WALLET}`)
  const st = storage()
  assert.deepEqual(saveOpening(WALLET, COIN, st), COIN)
  assert.deepEqual(JSON.parse(st().m.get(openingKey(WALLET))), { wallet: WALLET, ...COIN })
  assert.deepEqual(readOpening(WALLET, st), COIN)
  assert.equal(readOpening(OTHER, st), null)
  clearOpening(WALLET, st)
  assert.equal(readOpening(WALLET, st), null)
  assert.equal(st().m.size, 0)
})

test('a bad or foreign record reads as none', () => {
  assert.equal(readOpening(WALLET, storage()), null)
  assert.equal(readOpening(WALLET, storage({ [openingKey(WALLET)]: '{not json' })), null)
  assert.equal(readOpening(WALLET, storage({ [openingKey(WALLET)]: 'null' })), null)
  assert.equal(readOpening(WALLET, storage({ [openingKey(WALLET)]: '"text"' })), null)
  // another wallet's, under this wallet's key
  assert.equal(readOpening(WALLET, stored({ wallet: OTHER, ...COIN })), null)
  assert.equal(readOpening(WALLET, stored({ ...COIN })), null)
  // fields that aren't a coin
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, mint: 'not-a-key' })), null)
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, presale: 42 })), null)
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, symbol: '' })), null)
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, symbol: 'MOON CAT' })), null)
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, commit: 0 })), null)
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, commit: '300000000' })), null)
  assert.equal(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, commit: 0.5 })), null)
  // only the coin's fields come back
  assert.deepEqual(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, extra: 1 })), COIN)
  // no wallet: nothing to read or keep
  assert.equal(readOpening('', stored({ wallet: '', ...COIN })), null)
  assert.equal(saveOpening('', COIN, storage()), null)
})

test('storage that throws reads as none and never throws', () => {
  const broken = storage({}, true)
  assert.equal(readOpening(WALLET, broken), null)
  assert.deepEqual(saveOpening(WALLET, COIN, broken), COIN)
  assert.doesNotThrow(() => clearOpening(WALLET, broken))
  const gone = () => fail() // localStorage itself can't be reached
  assert.equal(readOpening(WALLET, gone), null)
  assert.deepEqual(saveOpening(WALLET, COIN, gone), COIN)
  assert.doesNotThrow(() => clearOpening(WALLET, gone))
})

test('a coin that is not one is not saved', () => {
  const st = storage()
  assert.equal(saveOpening(WALLET, { ...COIN, mint: '' }, st), null)
  assert.equal(saveOpening(WALLET, { ...COIN, commit: -1 }, st), null)
  assert.equal(saveOpening(WALLET, null, st), null)
  assert.equal(st().m.size, 0)
})

const unknown = () => Object.assign(new Error("We couldn't tell if it went through. Check your wallet before you try again."), { outcomeUnknown: true })
const exists = () => Object.assign(new Error('the tx fails: ix 1: AlreadyExists (28)'), { status: 400, body: { sent: false } })
const plain = () => Object.assign(new Error('You cancelled it in your wallet.'), { status: 400 })

test('afterFailedOpen: an unknown outcome keeps the coin; only "already open" clears it', () => {
  // the first try
  assert.equal(afterFailedOpen(unknown(), PID, false), 'pending')
  assert.equal(afterFailedOpen(plain(), PID, false), 'failed')
  assert.equal(afterFailedOpen(new Error('Finish the last step first'), PID, false), 'failed')
  assert.equal(afterFailedOpen(undefined, PID, false), 'failed')
  // a retry of the kept coin: everything but "already open" keeps it
  assert.equal(afterFailedOpen(exists(), PID, true), 'open')
  assert.equal(afterFailedOpen(unknown(), PID, true), 'pending')
  assert.equal(afterFailedOpen(plain(), PID, true), 'pending')
  assert.equal(afterFailedOpen(undefined, PID, true), 'pending')
  // by the program's log line or "(<pid>): custom 28" (engine/src/opening.js)
  assert.equal(afterFailedOpen(Object.assign(new Error('the tx fails'), { body: { logs: [`Program ${PID} failed: custom program error: 0x1c`] } }), PID, true), 'open')
  assert.equal(afterFailedOpen(new Error(`open (sig): ix 1 (${PID}): custom 28`), PID, true), 'open')
  assert.equal(afterFailedOpen(new Error(`open (sig): ix 1 (${OTHER}): custom 28`), PID, true), 'pending')
  // "outcomeUnknown" only as the flag itself
  assert.equal(afterFailedOpen({ message: 'x', outcomeUnknown: 'yes' }, PID, false), 'failed')
})

test('checkBeforeRetry: the server knowing the presale in any state means it opened', async () => {
  assert.equal(await checkBeforeRetry(async () => ({ presale: COIN.presale, where: 'er', state: 'OPEN' })), 'open')
  assert.equal(await checkBeforeRetry(async () => ({ presale: COIN.presale, where: 'closed', state: 'CLOSED' })), 'open')
  // 404: the server has neither the account nor a record of it
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('no such presale'), { status: 404 }))), 'retry')
  // a read that fails otherwise can't tell
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('the server said 503'), { status: 503 }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error("the server didn't answer in 10 s"), { status: 0, timedOut: true }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(new TypeError('Failed to fetch'))), 'unknown')
  assert.equal(await checkBeforeRetry(() => fail()), 'unknown')
  assert.equal(await checkBeforeRetry(async () => null), 'unknown')
})

test('shows: a presale:<key> snapshot shows the presale; "missing" and errors do not', () => {
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'snapshot', data: { presale: COIN.presale, where: 'er', state: 'OPEN' } }), true)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'snapshot', data: { presale: COIN.presale, where: 'closed', state: 'CLOSED' } }), true)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'missing' }), false)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'error', error: "couldn't read this right now" }), false)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'snapshot', data: null }), false)
  assert.equal(shows(undefined), false)
})
