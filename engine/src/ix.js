// One builder per program instruction. Account lists mirror each handler's doc comment
// in programs/presale/src (and the litesvm harness, tests/common/mod.rs).
// Amounts are BigInt lamports; keys are PublicKeys.

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ATA_PROGRAM, DELEGATION_PROGRAM, IX, IX_SYSVAR, MAGIC_CONTEXT, MAGIC_PROGRAM, MEMO, SYSTEM, TOKEN, TOKEN22, WSOL,
} from "./consts.js";
import {
  ata, bufferPda, configPda, metadataPda, poolAddresses, presalePda, programDataPda, recordPda, seatPda, vaultOf,
} from "./pdas.js";

const w = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const ws = (pubkey) => ({ pubkey, isSigner: true, isWritable: true });
const rs = (pubkey) => ({ pubkey, isSigner: true, isWritable: false });

export const u64le = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

function ix(pid, tag, data, keys) {
  return new TransactionInstruction({ programId: pid, keys, data: Buffer.concat([Buffer.from([tag]), ...data]) });
}

/** The gate account for entry instructions. An all-zero gate (config off) passes any
 *  account unsigned; otherwise the gate key must co-sign. */
const gateMeta = (gate) => (gate.equals(PublicKey.default) ? r(PublicKey.default) : rs(gate));

// ---- admin ----

export function initConfig(pid, { authority, admin, gate, bot, dbcConfig }) {
  return ix(pid, IX.INIT_CONFIG, [admin, gate, bot, dbcConfig].map((k) => k.toBuffer()), [
    ws(authority), w(configPda(pid)), r(programDataPda(pid)), r(SYSTEM),
  ]);
}

export function setConfig(pid, { signer, admin, gate, bot, dbcConfig }) {
  return ix(pid, IX.SET_CONFIG, [admin, gate, bot, dbcConfig].map((k) => k.toBuffer()), [rs(signer), w(configPda(pid))]);
}

// ---- entry (Solana) ----

export function openPresale(pid, { creator, gate, mint, feeDest, sessionKey, deposit, commit }) {
  const presale = presalePda(pid, mint);
  return ix(pid, IX.OPEN_PRESALE, [feeDest.toBuffer(), sessionKey.toBuffer(), u64le(deposit), u64le(commit)], [
    ws(creator), gateMeta(gate), r(configPda(pid)), rs(mint), w(presale), w(seatPda(pid, presale, creator)), r(SYSTEM),
  ]);
}

export function join(pid, { user, gate, presale, sessionKey, deposit }) {
  return ix(pid, IX.JOIN, [sessionKey.toBuffer(), u64le(deposit)], [
    ws(user), gateMeta(gate), r(configPda(pid)), r(presale), w(seatPda(pid, presale, user)), r(SYSTEM),
  ]);
}

/** kind 0: the creator delegates the Presale (`target` = presale). kind 1: a user
 *  delegates their Seat (`target` = seat, pass `presale`). */
export function delegate(pid, { payer, target, validator, kind, presale }) {
  const keys = [
    ws(payer), w(target), r(pid), w(bufferPda(pid, target)), w(recordPda(target)), w(metadataPda(target)),
    r(DELEGATION_PROGRAM), r(SYSTEM), r(validator),
  ];
  if (kind === 1) keys.push(r(presale));
  return ix(pid, IX.DELEGATE, [Buffer.from([kind])], keys);
}

// ---- ER ledger ----

export function setCommit(pid, { signer, seat, presale, amount }) {
  return ix(pid, IX.SET_COMMIT, [u64le(amount)], [rs(signer), w(seat), w(presale)]);
}

export function rotateKey(pid, { user, seat, key }) {
  return ix(pid, IX.ROTATE_KEY, [key.toBuffer()], [rs(user), w(seat)]);
}

export function leave(pid, { payer, seat }) {
  return ix(pid, IX.LEAVE, [], [ws(payer), w(seat), r(MAGIC_PROGRAM), w(MAGIC_CONTEXT)]);
}

export function expire(pid, { presale }) {
  return ix(pid, IX.EXPIRE, [], [w(presale)]);
}

export function commitPresale(pid, { payer, presale }) {
  return ix(pid, IX.COMMIT_PRESALE, [], [ws(payer), w(presale), r(MAGIC_PROGRAM), w(MAGIC_CONTEXT)]);
}

export function commitSeats(pid, { payer, presale, seats }) {
  return ix(pid, IX.COMMIT_SEATS, [], [ws(payer), r(presale), r(MAGIC_PROGRAM), w(MAGIC_CONTEXT), ...seats.map(w)]);
}

// ---- settle / launch / finish (Solana, permissionless unless noted) ----

export function settleSeat(pid, { cranker, seat, user, presale }) {
  return ix(pid, IX.SETTLE_SEAT, [], [
    ws(cranker), w(seat), r(recordPda(seat)), w(user), w(presale), r(recordPda(presale)), r(IX_SYSVAR),
  ]);
}

/** Bot only. `pot` is where the released SOL goes (its wSOL ATA). */
export function release(pid, { bot, presale, pot, mint, dbcConfig }) {
  const { pool, base, quote } = poolAddresses(dbcConfig, mint);
  return ix(pid, IX.RELEASE, [], [
    ws(bot), r(configPda(pid)), w(presale), r(recordPda(presale)), r(pot), w(ata(pot, WSOL, TOKEN)), r(mint),
    r(pool), r(base), r(quote), r(vaultOf(presale, mint)), r(IX_SYSVAR),
  ]);
}

/** The pool is read back to check the buy paid DBC's floor fee. */
export function settle(pid, { presale, pot, mint, minTokens, dbcConfig }) {
  return ix(pid, IX.SETTLE, [u64le(minTokens)], [
    w(presale), r(configPda(pid)), r(vaultOf(presale, mint)), r(ata(pot, WSOL, TOKEN)), r(IX_SYSVAR),
    r(poolAddresses(dbcConfig, mint).pool),
  ]);
}

export function claim(pid, { cranker, presale, user, mint }) {
  return ix(pid, IX.CLAIM, [], [
    ws(cranker), w(presale), w(seatPda(pid, presale, user)), w(user), w(vaultOf(presale, mint)),
    w(ata(user, mint, TOKEN22)), r(mint), r(TOKEN22), r(ATA_PROGRAM), r(SYSTEM), r(IX_SYSVAR), r(MEMO),
  ]);
}

export function fail(pid, { presale }) {
  return ix(pid, IX.FAIL, [], [w(presale), r(recordPda(presale))]);
}

export function closePresale(pid, { presale, creator, mint }) {
  return ix(pid, IX.CLOSE_PRESALE, [], [
    w(presale), r(recordPda(presale)), w(creator), w(vaultOf(presale, mint)), w(mint), r(TOKEN22),
  ]);
}
