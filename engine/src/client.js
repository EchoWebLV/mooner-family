// What a wallet client (the web app) builds: the entry txs the gate co-signs, the ledger
// txs a session key sends to the ER, the text a creator signs for a mint, and the commit
// rules. No node: imports, so the web app bundles this file as is.

import { Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import * as I from "./ix.js";
import { presalePda, seatPda } from "./pdas.js";

/** open_presale + delegate(presale) + delegate(creator seat): the only open the gate signs. */
export function openIxs(pid, { creator, gate, mint, feeDest, sessionKey, deposit, commit, validator }) {
  const presale = presalePda(pid, mint);
  return [
    I.openPresale(pid, { creator, gate, mint, feeDest, sessionKey, deposit, commit }),
    I.delegate(pid, { payer: creator, target: presale, validator, kind: 0 }),
    I.delegate(pid, { payer: creator, target: seatPda(pid, presale, creator), validator, kind: 1, presale }),
  ];
}

/** join + delegate(seat): the only join the gate signs. `validator` is the presale's. */
export function joinIxs(pid, { user, gate, presale, sessionKey, deposit, validator }) {
  return [
    I.join(pid, { user, gate, presale, sessionKey, deposit }),
    I.delegate(pid, { payer: user, target: seatPda(pid, presale, user), validator, kind: 1, presale }),
  ];
}

/** An unsigned v0 tx for the wallet to sign (entry txs carry no lookup tables). */
export function unsignedTx({ ixs, payer, blockhash }) {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg);
}

/** An unsigned legacy tx for the ER, paid by `payer` (ER txs cost nothing). */
export function unsignedErTx({ ixs, payer, blockhash }) {
  return new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...ixs);
}

/** The text a creator signs to ask for a token (server/auth.js checks it). `imageHash` is
 *  the sha256 hex of the image bytes; `detailsHash` of JSON.stringify([description,
 *  twitter, telegram, website]), with "" for a missing one. */
export function mintMessageText({ wallet, name, symbol, imageHash, detailsHash, time }) {
  return [
    "Mooner: create a token",
    `wallet: ${wallet.toBase58()}`,
    `name: ${name}`,
    `symbol: ${symbol}`,
    `image: ${imageHash}`,
    `details: ${detailsHash}`,
    `time: ${time}`,
  ].join("\n");
}

/** The exact text a wallet signs to sign in (server/social.js checks it). */
export const loginMessage = (wallet, time) => ["Mooner: sign in", `wallet: ${wallet}`, `time: ${time}`].join("\n");

/** A seat size the program takes (util.rs valid_seat). Amounts are BigInt lamports. */
export const validSeat = (amount, N) => amount >= N.MIN_SEAT && amount <= N.MAX_SEAT && amount % N.STEP === 0n;

/** The commit set_commit leaves after the room cut (util.rs cut_to_room); null: no room
 *  for a raise. `others` = raised without this seat. */
export function cutToRoom(amount, current, others, target) {
  const room = target > others ? target - others : 0n;
  if (amount <= current || amount <= room) return amount;
  if (room === 0n) return null;
  return room;
}
