// The open the site couldn't tell went through (web/src/real/opening.js): the record kept
// per wallet (from before the open is signed), and what a failure, the read before a retry
// and a push mean for it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  afterFailedOpen, canStartOver, checkBeforeRetry, clearOpening, forgetOpening, keptAfter, NO_SUCH_PRESALE, openedNote, openingKey, openKept, readOpening,
  saveOpening, seatFit, shows, START_OVER_MS,
} from '../src/real/opening.js'

const WALLET = '7'.repeat(43)
const OTHER = '8'.repeat(43)
const PID = '9'.repeat(43)
const AT = 1_790_000_000_000
const COIN = { mint: 'M'.repeat(43), presale: 'P'.repeat(44), symbol: 'MCAT', commit: 300_000_000, at: AT }
const SECOND = { ...COIN, mint: 'N'.repeat(43), presale: 'Q'.repeat(44) }

/** localStorage as a Map; `broken` makes every call throw (private mode), `full` only setItem. */
function storage(entries = {}, broken = false, full = false) {
  const m = new Map(Object.entries(entries))
  const s = {
    m,
    getItem: (k) => (broken ? fail() : (m.get(k) ?? null)),
    setItem: (k, v) => (broken || full ? fail() : void m.set(k, String(v))),
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
  clearOpening(WALLET, COIN.presale, st)
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

test('a missing or broken `at` keeps the coin, with no time', () => {
  for (const at of [undefined, null, 0, -1, 1.5, '1790000000000', Infinity]) {
    assert.deepEqual(readOpening(WALLET, stored({ wallet: WALLET, ...COIN, at })), { ...COIN, at: null }, String(at))
  }
})

test('storage that throws: the record is kept in memory, per wallet, until cleared', () => {
  for (const st of [storage({}, true), () => fail(), storage({}, false, true)]) {
    assert.equal(readOpening(WALLET, st), null)
    assert.deepEqual(saveOpening(WALLET, COIN, st), COIN)
    // a wallet switch and back reads it again (store.ts followOpening)
    assert.equal(readOpening(OTHER, st), null)
    assert.deepEqual(readOpening(WALLET, st), COIN)
    // another coin's clear leaves it
    assert.doesNotThrow(() => clearOpening(WALLET, SECOND.presale, st))
    assert.deepEqual(readOpening(WALLET, st), COIN)
    assert.doesNotThrow(() => clearOpening(WALLET, COIN.presale, st))
    assert.equal(readOpening(WALLET, st), null)
  }
  // storage that works again but never got this page's save: the memory copy
  const blocked = storage({}, true)
  saveOpening(WALLET, COIN, blocked)
  assert.deepEqual(readOpening(WALLET, storage()), COIN)
  clearOpening(WALLET, COIN.presale, storage())
  assert.equal(readOpening(WALLET, blocked), null)
})

test('storage emptied without a reload: the memory copy, until another tab clears the coin', () => {
  // a save that reached storage, then storage emptied (a wipe, or storage.clear() in another
  // tab): the memory copy stands in
  const st = storage()
  saveOpening(WALLET, COIN, st)
  st().m.clear()
  assert.deepEqual(readOpening(WALLET, st), COIN)
  assert.deepEqual(readOpening(WALLET, storage({}, true)), COIN)
  assert.equal(readOpening(OTHER, st), null)
  // storage that holds the record again: storage's
  st().m.set(openingKey(WALLET), JSON.stringify({ wallet: WALLET, ...COIN, at: AT + 1 }))
  assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: AT + 1 })
  // another tab cleared another coin (its storage event's old value): this copy stays
  st().m.clear()
  forgetOpening(WALLET, JSON.stringify({ wallet: WALLET, ...SECOND }))
  forgetOpening(WALLET, null)
  forgetOpening(WALLET, '{not json')
  assert.deepEqual(readOpening(WALLET, st), COIN)
  // another tab cleared this coin (its Start over, or its presale showed): the copy goes too
  forgetOpening(WALLET, JSON.stringify({ wallet: WALLET, ...COIN, at: AT + 1 }))
  assert.equal(readOpening(WALLET, st), null)
  assert.equal(readOpening(WALLET, storage({}, true)), null)
})

test('clearOpening clears only the coin it names', () => {
  const st = storage()
  saveOpening(WALLET, COIN, st)
  clearOpening(WALLET, SECOND.presale, st)
  assert.deepEqual(readOpening(WALLET, st), COIN)
  assert.equal(st().m.size, 1)
  // a record another tab wrote over this one: its coin is the one kept
  st().m.set(openingKey(WALLET), JSON.stringify({ wallet: WALLET, ...SECOND }))
  clearOpening(WALLET, COIN.presale, st)
  assert.deepEqual(readOpening(WALLET, st), SECOND)
  clearOpening(WALLET, SECOND.presale, st)
  assert.equal(readOpening(WALLET, st), null)
  assert.equal(st().m.size, 0)
})

test('a coin that is not one is not saved', () => {
  const st = storage()
  assert.equal(saveOpening(WALLET, { ...COIN, mint: '' }, st), null)
  assert.equal(saveOpening(WALLET, { ...COIN, commit: -1 }, st), null)
  assert.equal(saveOpening(WALLET, null, st), null)
  assert.equal(st().m.size, 0)
  assert.equal(readOpening(WALLET, st), null)
})

const unknown = () => Object.assign(new Error("We couldn't tell if it went through. Check your wallet before you try again."), { outcomeUnknown: true })
const exists = () => Object.assign(new Error('the tx fails: ix 1: AlreadyExists (28)'), { status: 400, body: { sent: false } })
const plain = () => Object.assign(new Error('You cancelled it in your wallet.'), { status: 400 })
// what a wallet throws when you reject the request, and the server's 4xx from before the send
const refused = () => Object.assign(new Error('User rejected the request.'), { code: 4001 })
const unsent = () => Object.assign(new Error('the tx fails: ix 1: NoRoom (6)'), { status: 400, body: { error: 'the tx fails: ix 1: NoRoom (6)', sent: false } })
// the server's own 404 for a presale it has no account or record of (engine/server/api.js onePresale)
const missing = () => Object.assign(new Error('no such presale'), { status: 404, body: { error: 'no such presale' } })

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

test('openKept: the coin is kept from before the open is signed', async () => {
  const NOW = AT + 60_000
  const fresh = { ...COIN, at: null } // a first try: no record yet
  // in flight: kept, with `at` now, so a reload now finds it
  for (const [coin, retrying] of [[fresh, false], [COIN, true]]) {
    const st = storage()
    let seen
    const r = await openKept(WALLET, coin, async () => {
      seen = readOpening(WALLET, st)
      return 'sig'
    }, { pid: PID, retrying, clock: () => NOW, storage: st })
    assert.deepEqual(seen, { ...COIN, at: NOW })
    // success: still kept (the store clears it as the presale shows, through opened)
    assert.deepEqual(r, { ok: true, value: 'sig' })
    assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: NOW })
    clearOpening(WALLET, COIN.presale, st)
  }
  // a reload mid-open: the page that reads now finds it
  {
    const st = storage()
    let release
    const running = openKept(WALLET, fresh, () => new Promise((r) => (release = r)), { pid: PID, clock: () => NOW, storage: st })
    assert.deepEqual(JSON.parse(st().m.get(openingKey(WALLET))), { wallet: WALLET, ...COIN, at: NOW })
    release('sig')
    await running
    clearOpening(WALLET, COIN.presale, st)
  }
})

test('openKept: what a failure leaves', async () => {
  const NOW = AT + 60_000
  const fresh = { ...COIN, at: null }
  const attempt = async (coin, retrying, error) => {
    const st = storage()
    if (retrying) saveOpening(WALLET, coin, st)
    const r = await openKept(WALLET, coin, async () => {
      throw error
    }, { pid: PID, retrying, clock: () => NOW, storage: st })
    const left = readOpening(WALLET, st)
    if (left) clearOpening(WALLET, left.presale, st)
    return [r.ok, r.verdict, r.error === error, left]
  }
  // a first try that plainly failed: nothing went out, nothing kept
  assert.deepEqual(await attempt(fresh, false, plain()), [false, 'failed', true, null])
  // an unknown outcome: kept, as signed now
  assert.deepEqual(await attempt(fresh, false, unknown()), [false, 'pending', true, { ...COIN, at: NOW }])
  assert.deepEqual(await attempt(COIN, true, unknown()), [false, 'pending', true, { ...COIN, at: NOW }])
  // a retry that plainly failed (the wallet refused it, or the server's 4xx with sent: false):
  // still kept, since the first open may still land, and the last open that may land is the
  // one before
  assert.deepEqual(await attempt(COIN, true, plain()), [false, 'pending', true, COIN])
  assert.deepEqual(await attempt(COIN, true, refused()), [false, 'pending', true, COIN])
  assert.deepEqual(await attempt(COIN, true, unsent()), [false, 'pending', true, COIN])
  // a first try's: dropped, as nothing of it went out and nothing before it was kept
  assert.deepEqual(await attempt(fresh, false, refused()), [false, 'failed', true, null])
  assert.deepEqual(await attempt(fresh, false, unsent()), [false, 'failed', true, null])
  assert.deepEqual(await attempt({ ...COIN, at: null }, true, plain()), [false, 'pending', true, { ...COIN, at: null }])
  // "already open": left for the store, which clears it as it goes to the presale
  assert.deepEqual(await attempt(COIN, true, exists()), [false, 'open', true, { ...COIN, at: NOW }])
  // a coin that can't be kept isn't opened
  let called = false
  const r = await openKept(WALLET, { ...COIN, mint: '' }, async () => {
    called = true
  }, { pid: PID, clock: () => NOW, storage: storage() })
  assert.equal(called, false)
  assert.equal(r.ok, false)
  assert.equal(r.verdict, 'failed')
})

test('openKept: what another tab saved during the try stands', async () => {
  const T0 = AT // the kept coin's last open
  const TA = T0 + START_OVER_MS + 60_000 // this try, long after
  const TB = TA + 1 // another tab's try of the same coin, which ended unknown
  const other = (st, record) => st().m.set(openingKey(WALLET), JSON.stringify({ wallet: WALLET, ...record }))
  const tried = async (coin, retrying, error, during) => {
    const st = storage()
    if (retrying) saveOpening(WALLET, coin, st)
    const r = await openKept(WALLET, coin, async () => {
      during(st)
      throw error
    }, { pid: PID, retrying, clock: () => TA, storage: st })
    const left = readOpening(WALLET, st)
    // storage emptied after: the memory copy is what storage held, never this try's own save
    // over another tab's (a coin that was never sent, or an older `at`)
    st().m.clear()
    assert.deepEqual(readOpening(WALLET, st), left)
    if (left) clearOpening(WALLET, left.presale, st)
    return [r.verdict, left]
  }
  // a retry this wallet refused doesn't put the old `at` back over the other tab's newer one,
  // so Start over, judged on what storage holds after the try, isn't offered
  const [verdict, back] = await tried({ ...COIN, at: T0 }, true, refused(), (st) => other(st, { ...COIN, at: TB }))
  assert.equal(verdict, 'pending')
  assert.deepEqual(back, { ...COIN, at: TB })
  assert.equal(canStartOver(back, 'retry', TB + 1), false)
  assert.equal(canStartOver(back, 'retry', TB + START_OVER_MS), false)
  assert.equal(canStartOver({ ...COIN, at: T0 }, 'retry', TB + 1), true) // what the caller's copy said
  // nor does a first try's plain failure clear it
  assert.deepEqual(await tried({ ...COIN, at: null }, false, refused(), (st) => other(st, { ...COIN, at: TB })), ['failed', { ...COIN, at: TB }])
  assert.deepEqual(await tried({ ...COIN, at: null }, false, refused(), (st) => other(st, SECOND)), ['failed', SECOND])
  // nor an unknown outcome write over another coin kept since
  assert.deepEqual(await tried({ ...COIN, at: null }, false, unknown(), (st) => other(st, SECOND)), ['pending', SECOND])
  // an unknown outcome when storage was emptied meanwhile, or another tab cleared the coin
  // (its storage event dropped this page's copy): kept again, as it may land (the safe side)
  assert.deepEqual(await tried({ ...COIN, at: null }, false, unknown(), (st) => st().m.clear()), ['pending', { ...COIN, at: TA }])
  const cleared = (st) => {
    const was = st().m.get(openingKey(WALLET))
    st().m.delete(openingKey(WALLET))
    forgetOpening(WALLET, was)
  }
  assert.deepEqual(await tried({ ...COIN, at: null }, false, unknown(), cleared), ['pending', { ...COIN, at: TA }])
  // and a plain failure then leaves nothing
  assert.deepEqual(await tried({ ...COIN, at: T0 }, true, refused(), cleared), ['pending', null])
})

test('openKept: a refused retry puts back the record as storage held it, not its caller\'s copy', async () => {
  const T0 = AT // the caller's copy: its last open, long ago
  // storage holds a newer save of the coin than the caller's copy
  const st = stored({ wallet: WALLET, ...COIN, at: T0 + 5_000 })
  const r = await openKept(WALLET, { ...COIN, at: T0 }, async () => {
    throw refused()
  }, { pid: PID, retrying: true, clock: () => T0 + 9_000, storage: st })
  assert.equal(r.verdict, 'pending')
  assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: T0 + 5_000 })
  clearOpening(WALLET, COIN.presale, st)
})

test('openKept: a retry refused here after another tab\'s try went out keeps that try\'s `at`', async () => {
  // tab A saved X@TA and its open is out; this tab (B) still holds X@T0, gets its 404, saves
  // X@TB, and its wallet refuses: storage keeps A's save, so Start over isn't offered
  const T0 = AT
  const TA = T0 + START_OVER_MS + 60_000
  const TB = TA + 2_000
  const st = stored({ wallet: WALLET, ...COIN, at: TA })
  await openKept(WALLET, { ...COIN, at: T0 }, async () => {
    throw refused()
  }, { pid: PID, retrying: true, clock: () => TB, storage: st })
  const back = readOpening(WALLET, st)
  assert.deepEqual(back, { ...COIN, at: TA })
  assert.equal(canStartOver(back, 'retry', TB + 1), false)
  clearOpening(WALLET, COIN.presale, st)
})

test('openKept: a refused retry of a coin no longer kept (another tab cleared it) leaves nothing', async () => {
  const st = storage()
  await openKept(WALLET, { ...COIN, at: AT }, async () => {
    throw refused()
  }, { pid: PID, retrying: true, clock: () => AT + 9_000, storage: st })
  assert.equal(st().m.size, 0)
  assert.equal(readOpening(WALLET, st), null)
})

test('openKept: an unknown never moves the coin\'s `at` back', async () => {
  const REPORT = AT + 10_000
  const tried = async (otherAt) => {
    const st = storage()
    await openKept(WALLET, { ...COIN, at: null }, async () => {
      // another tab's save of the same coin while this try was out
      st().m.set(openingKey(WALLET), JSON.stringify({ wallet: WALLET, ...COIN, at: otherAt }))
      throw unknown()
    }, { pid: PID, clock: () => REPORT, storage: st })
    const left = readOpening(WALLET, st)
    clearOpening(WALLET, COIN.presale, st)
    return left
  }
  // its save is older than this report: kept as of the report
  assert.deepEqual(await tried(AT + 1), { ...COIN, at: REPORT })
  // newer: kept as of it
  assert.deepEqual(await tried(REPORT + 50_000), { ...COIN, at: REPORT + 50_000 })
})

test('openKept: the coin is saved again once the wallet signs', async () => {
  const START = AT // before the wallet prompt
  const SIGNED = AT + 180_000 // a prompt held open for 3 minutes
  const END = SIGNED + 90_000 // the unknown, reported after the wait
  let t = START
  const clock = () => t
  // a first try that ends unknown: kept as of the sign while it waits, then as of the report
  {
    t = START
    const st = storage()
    const r = await openKept(WALLET, { ...COIN, at: null }, async (signed) => {
      assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: START })
      t = SIGNED
      signed()
      assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: SIGNED })
      t = END
      throw unknown()
    }, { pid: PID, clock, storage: st })
    assert.equal(r.verdict, 'pending')
    assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: END })
    clearOpening(WALLET, COIN.presale, st)
  }
  // a retry that fails plainly after the sign (the server refused to co-sign): the sign-time
  // save stays, not the one before the prompt nor the record before the try
  {
    t = START
    const st = stored({ wallet: WALLET, ...COIN, at: AT - 1 })
    await openKept(WALLET, COIN, async (signed) => {
      t = SIGNED
      signed()
      t = END
      throw unsent()
    }, { pid: PID, retrying: true, clock, storage: st })
    assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: SIGNED })
    clearOpening(WALLET, COIN.presale, st)
  }
  // a first try that fails plainly after the sign: its own save (the sign-time one) is cleared
  {
    t = START
    const st = storage()
    const r = await openKept(WALLET, { ...COIN, at: null }, async (signed) => {
      t = SIGNED
      signed()
      throw unsent()
    }, { pid: PID, clock, storage: st })
    assert.equal(r.verdict, 'failed')
    assert.equal(readOpening(WALLET, st), null)
    assert.equal(st().m.size, 0)
  }
  // another tab saved the coin after this try did: the sign doesn't write over it
  {
    t = START
    const st = storage()
    const OTHER_AT = START + 1
    await openKept(WALLET, { ...COIN, at: null }, async (signed) => {
      st().m.set(openingKey(WALLET), JSON.stringify({ wallet: WALLET, ...COIN, at: OTHER_AT }))
      t = SIGNED
      signed()
      assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: OTHER_AT })
      throw refused()
    }, { pid: PID, clock, storage: st })
    assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: OTHER_AT })
    clearOpening(WALLET, COIN.presale, st)
  }
})

test('keptAfter: what a try leaves pending, and whether Start over is offered', async () => {
  const OLD = AT + START_OVER_MS + 1
  // another tab's success cleared the coin while this retry was in the wallet (its storage
  // event dropped this page's copy), then the wallet refused: nothing is written back, and no
  // Start over
  {
    const st = stored({ wallet: WALLET, ...COIN })
    saveOpening(WALLET, COIN, st)
    await openKept(WALLET, COIN, async () => {
      const was = st().m.get(openingKey(WALLET))
      st().m.delete(openingKey(WALLET))
      forgetOpening(WALLET, was)
      throw refused()
    }, { pid: PID, retrying: true, clock: () => OLD, storage: st })
    assert.equal(st().m.size, 0)
    assert.deepEqual(keptAfter(WALLET, COIN, { asked: true, read: 'retry', now: OLD + START_OVER_MS, storage: st }), { kept: null, leave: false })
    assert.equal(st().m.size, 0)
    assert.equal(readOpening(WALLET, st), null)
  }
  // before the wallet was asked (the read failed, no SOL for it): the caller's coin is put
  // back, but Start over isn't offered on a record that wasn't there
  {
    const st = storage()
    assert.deepEqual(keptAfter(WALLET, COIN, { asked: false, read: 'retry', now: OLD, storage: st }), { kept: COIN, leave: false })
    assert.deepEqual(readOpening(WALLET, st), COIN)
    // there now: the server's 404 and an old `at` offer it; anything else doesn't
    assert.deepEqual(keptAfter(WALLET, COIN, { asked: true, read: 'retry', now: OLD, storage: st }), { kept: COIN, leave: true })
    assert.deepEqual(keptAfter(WALLET, COIN, { asked: true, read: null, now: OLD, storage: st }), { kept: COIN, leave: false })
    assert.deepEqual(keptAfter(WALLET, COIN, { asked: true, read: 'retry', now: AT + 1, storage: st }), { kept: COIN, leave: false })
    // another coin kept now: that one, and no Start over for it on this coin's 404
    st().m.set(openingKey(WALLET), JSON.stringify({ wallet: WALLET, ...SECOND }))
    assert.deepEqual(keptAfter(WALLET, COIN, { asked: true, read: 'retry', now: OLD, storage: st }), { kept: SECOND, leave: false })
    clearOpening(WALLET, SECOND.presale, st)
    clearOpening(WALLET, COIN.presale, st)
  }
})

test('openKept: an unknown outcome is kept as of when it was reported', async () => {
  const START = AT
  const END = AT + 120_000 // a long wallet prompt, then the wait
  for (const retrying of [false, true]) {
    const st = storage()
    if (retrying) saveOpening(WALLET, COIN, st)
    const times = [START, END]
    const r = await openKept(WALLET, { ...COIN, at: retrying ? AT : null }, async () => {
      assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: START })
      throw unknown()
    }, { pid: PID, retrying, clock: () => times.shift(), storage: st })
    assert.equal(r.verdict, 'pending')
    assert.deepEqual(readOpening(WALLET, st), { ...COIN, at: END })
    clearOpening(WALLET, COIN.presale, st)
  }
})

test('openKept: another coin kept for the wallet is not written over, and this one is not opened', async () => {
  const KEPT = { ...SECOND, symbol: 'DOGE' }
  for (const retrying of [false, true]) {
    const st = stored({ wallet: WALLET, ...KEPT })
    let called = false
    const r = await openKept(WALLET, { ...COIN, at: retrying ? AT : null }, async () => {
      called = true
    }, { pid: PID, retrying, clock: () => AT + 1, storage: st })
    assert.equal(called, false)
    assert.equal(r.ok, false)
    assert.equal(r.verdict, 'other')
    assert.deepEqual(r.kept, KEPT)
    assert.match(r.error.message, /\$DOGE/)
    assert.deepEqual(JSON.parse(st().m.get(openingKey(WALLET))), { wallet: WALLET, ...KEPT })
    clearOpening(WALLET, KEPT.presale, st)
  }
})

test('checkBeforeRetry: the server knowing the presale in any state means it opened', async () => {
  assert.equal(await checkBeforeRetry(async () => ({ presale: COIN.presale, where: 'er', state: 'OPEN' })), 'open')
  assert.equal(await checkBeforeRetry(async () => ({ presale: COIN.presale, where: 'closed', state: 'CLOSED' })), 'open')
  // the server's own 404: it has neither the account nor a record of it
  assert.equal(NO_SUCH_PRESALE, 'no such presale')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(missing())), 'retry')
  // any other 404 (a proxy's, a wrong path, no body) can't tell
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('no such presale'), { status: 404 }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('not found'), { status: 404, body: { error: 'not found' } }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('the server said 404'), { status: 404, body: null }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('x'), { status: 404, body: { error: 'No such presale' } }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('x'), { status: 400, body: { error: 'no such presale' } }))), 'unknown')
  // a read that fails otherwise can't tell
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error('the server said 503'), { status: 503 }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(Object.assign(new Error("the server didn't answer in 10 s"), { status: 0, timedOut: true }))), 'unknown')
  assert.equal(await checkBeforeRetry(async () => Promise.reject(new TypeError('Failed to fetch'))), 'unknown')
  assert.equal(await checkBeforeRetry(() => fail()), 'unknown')
  assert.equal(await checkBeforeRetry(async () => null), 'unknown')
})

test('canStartOver: only a 404 for an open signed more than START_OVER_MS ago', async () => {
  assert.equal(START_OVER_MS, 5 * 60_000)
  const old = AT + START_OVER_MS + 1
  const read = async (answer) => checkBeforeRetry(answer)
  const r404 = await read(async () => Promise.reject(missing()))
  // 404 and old: yes
  assert.equal(canStartOver(COIN, r404, old), true)
  assert.equal(canStartOver(COIN, r404, AT + 3_600_000), true)
  // 404 and new: no
  assert.equal(canStartOver(COIN, r404, AT + START_OVER_MS), false)
  assert.equal(canStartOver(COIN, r404, AT + 1000), false)
  assert.equal(canStartOver(COIN, r404, AT - 1000), false) // a clock behind the record's
  // a 200, a 5xx, another 404 or a thrown read: no
  assert.equal(canStartOver(COIN, await read(async () => Promise.reject(Object.assign(new Error('not found'), { status: 404, body: { error: 'not found' } }))), old), false)
  assert.equal(canStartOver(COIN, await read(async () => Promise.reject(Object.assign(new Error('the server said 404'), { status: 404, body: null }))), old), false)
  assert.equal(canStartOver(COIN, await read(async () => ({ presale: COIN.presale, state: 'CLOSED' })), old), false)
  assert.equal(canStartOver(COIN, await read(async () => Promise.reject(Object.assign(new Error('the server said 503'), { status: 503 }))), old), false)
  assert.equal(canStartOver(COIN, await read(() => fail()), old), false)
  // a missing or broken `at`: no
  for (const at of [undefined, null, 0, -1, 1.5, String(AT), NaN]) assert.equal(canStartOver({ ...COIN, at }, r404, old), false, String(at))
  assert.equal(canStartOver(null, r404, old), false)
  assert.equal(canStartOver(COIN, r404, NaN), false)
})

test('openedNote: an open presale asks for a share; one that is done says so', () => {
  assert.equal(openedNote('MCAT', true), '$MCAT presale is open. Share it to fill the pool.')
  assert.equal(openedNote('MCAT', false), "$MCAT's presale is already done.")
})

test('seatFit: the kept commit against the presale numbers now (flows.js openPresale)', () => {
  const N = { MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n, TARGET: 500_000_000n }
  assert.equal(seatFit(300_000_000, N), 'ok')
  assert.equal(seatFit(400_000_000, N), 'ok')
  // the creator leaves room for one more seat
  assert.equal(seatFit(450_000_000, N), 'over')
  assert.equal(seatFit(300_000_000, { ...N, MAX_SEAT: 200_000_000n }), 'over')
  assert.equal(seatFit(300_000_000, { ...N, TARGET: 300_000_000n }), 'over')
  assert.equal(seatFit(300_000_000, { ...N, MIN_SEAT: 400_000_000n }), 'off')
  assert.equal(seatFit(305_000_000, N), 'off')
})

test('shows: a presale:<key> snapshot shows the presale; "missing" and errors do not', () => {
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'snapshot', data: { presale: COIN.presale, where: 'er', state: 'OPEN' } }), true)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'snapshot', data: { presale: COIN.presale, where: 'closed', state: 'CLOSED' } }), true)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'missing' }), false)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'error', error: "couldn't read this right now" }), false)
  assert.equal(shows({ topic: `presale:${COIN.presale}`, type: 'snapshot', data: null }), false)
  assert.equal(shows(undefined), false)
})
