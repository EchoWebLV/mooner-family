// The Seeker Genesis check (spec "Genesis perk"): does a wallet hold a Seeker Genesis Token?
// Solana Mobile's rule (docs.solanamobile.com, "Seeker Genesis Token"): a Token-2022 mint
// whose MetadataPointer's metadata address and whose TokenGroupMember's group are both the
// Genesis group mint; token accounts with a zero balance don't count. On top: the mint is
// Token-2022's, and its member extension names the mint itself. Only the group's update
// authority can make a mint a member, so that is the check that can't be faked. Read from
// raw bytes; nothing here sends.

import { PublicKey } from "@solana/web3.js";
import { tokenAmount } from "../src/layout.js";
import { accountsOf } from "./api.js";

export const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const GENESIS_GROUP = new PublicKey("GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te");

const BASE = 165; // a Token-2022 mint's base, padded to a token account's size
const MINT = 1; // the account-type byte at BASE
const METADATA_POINTER = 18; // authority 32, metadata address 32
const GROUP_MEMBER = 23; // mint 32, group 32, member number u64

/** A Token-2022 mint's extensions: Map type -> value bytes, in account order. Empty for
 *  anything that isn't a mint with extensions. */
export function mintExtensions(data) {
  const d = Buffer.from(data);
  const out = new Map();
  if (d.length <= BASE || d[BASE] !== MINT) return out;
  for (let i = BASE + 1; i + 4 <= d.length; ) {
    const type = d.readUInt16LE(i);
    const len = d.readUInt16LE(i + 2);
    if ((type === 0 && len === 0) || i + 4 + len > d.length) break; // padding, or cut short
    out.set(type, d.subarray(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** `acc` (an AccountInfo, or null) is the Seeker Genesis Token mint `mint` (a PublicKey). */
export function isGenesisMint(mint, acc) {
  if (!acc?.owner?.equals(TOKEN_2022)) return false;
  const ext = mintExtensions(acc.data);
  const pointer = ext.get(METADATA_POINTER);
  const member = ext.get(GROUP_MEMBER);
  if (!pointer || pointer.length < 64 || !member || member.length < 64) return false;
  const group = GENESIS_GROUP.toBuffer();
  return group.equals(pointer.subarray(32, 64)) && group.equals(member.subarray(32, 64)) && mint.toBuffer().equals(member.subarray(0, 32));
}

/** The Genesis mints `wallet` (a PublicKey) holds, base58: its Token-2022 accounts with a
 *  balance, each mint read once. */
export async function findGenesis(l1, wallet) {
  const { value } = await l1.getTokenAccountsByOwner(wallet, { programId: TOKEN_2022 });
  const held = value.filter((a) => tokenAmount(a.account.data) > 0n);
  const mints = [...new Set(held.map((a) => new PublicKey(a.account.data.subarray(0, 32)).toBase58()))];
  if (!mints.length) return [];
  const accs = await accountsOf(l1, mints.map((m) => new PublicKey(m)));
  return mints.filter((m, i) => isGenesisMint(new PublicKey(m), accs[i]));
}
