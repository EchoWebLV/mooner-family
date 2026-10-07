// The Seeker Genesis check (server/genesis.js), against mainnet bytes saved in test/fixtures
// (getAccountInfo on api.mainnet-beta.solana.com, slots 452493334 and 452493336): a Genesis
// member mint, the Genesis group mint itself, and a holder's token account. The holder came
// from the newest finalized Genesis mint tx then (getSignaturesForAddress on the group mint:
// 4M7Rg5VW…, slot 452360249). See the plan's Task 5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { GENESIS_GROUP, TOKEN_2022, findGenesis, isGenesisMint, mintExtensions } from "../server/genesis.js";

function fixture(name) {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  return { pubkey: new PublicKey(j.pubkey), account: { owner: new PublicKey(j.owner), data: Buffer.from(j.data, "base64") } };
}
const member = fixture("genesis-member-mint");
const group = fixture("genesis-group-mint");
const holder = fixture("genesis-holder-account");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WALLET = new PublicKey("sWM5jwoJwR7vVwheHVFp1eFectxQM2ze88cmiFFHp8t");

test("genesis: the fixtures are what they say", () => {
  assert.equal(member.pubkey.toBase58(), "HAF57K9jMt61dZnQ5pqwNeuBgfguSRNqXqiuNjaF1Vtr");
  assert.ok(group.pubkey.equals(GENESIS_GROUP));
  for (const f of [member, group, holder]) assert.ok(f.account.owner.equals(TOKEN_2022));
  assert.ok(new PublicKey(holder.account.data.subarray(0, 32)).equals(member.pubkey), "the holder's account is of the member mint");
  assert.ok(new PublicKey(holder.account.data.subarray(32, 64)).equals(WALLET));
  assert.equal(holder.account.data.readBigUInt64LE(64), 1n);
});

test("genesis: a Token-2022 mint's extensions, read from its TLV", () => {
  const ext = mintExtensions(member.account.data);
  assert.deepEqual([...ext.keys()], [18, 12, 3, 22, 23], "MetadataPointer, PermanentDelegate, MintCloseAuthority, GroupMemberPointer, TokenGroupMember");
  const m = ext.get(23);
  assert.equal(m.length, 72);
  assert.ok(new PublicKey(m.subarray(0, 32)).equals(member.pubkey));
  assert.ok(new PublicKey(m.subarray(32, 64)).equals(GENESIS_GROUP));
  assert.equal(m.readBigUInt64LE(64), 121065n, "its member number");
  assert.ok(new PublicKey(ext.get(18).subarray(32, 64)).equals(GENESIS_GROUP), "metadata at the group");
  assert.deepEqual([...mintExtensions(group.account.data).keys()], [18, 20, 3, 19, 21], "the group mint has no member extension");
  assert.equal(mintExtensions(Buffer.alloc(82)).size, 0, "a mint with no extensions");
  assert.equal(mintExtensions(holder.account.data).size, 0, "a token account isn't a mint");
});

test("genesis: a Genesis mint is Token-2022's, points its metadata at the group, and is a member of it", () => {
  assert.equal(isGenesisMint(member.pubkey, member.account), true);
  assert.equal(isGenesisMint(group.pubkey, group.account), false, "the group mint itself isn't a member");
  assert.equal(isGenesisMint(member.pubkey, { ...member.account, owner: TOKEN }), false, "not Token-2022's");
  assert.equal(isGenesisMint(Keypair.generate().publicKey, member.account), false, "the member extension names another mint");
  assert.equal(isGenesisMint(member.pubkey, null), false, "no account");
  const flip = (at) => {
    const data = Buffer.from(member.account.data);
    data[at] ^= 1;
    return { ...member.account, data };
  };
  // the MetadataPointer's value starts at 170 (metadata address at +32); the member's at 378 (group at +32)
  assert.ok(new PublicKey(member.account.data.subarray(202, 234)).equals(GENESIS_GROUP));
  assert.ok(new PublicKey(member.account.data.subarray(410, 442)).equals(GENESIS_GROUP));
  assert.equal(isGenesisMint(member.pubkey, flip(202)), false, "metadata pointed elsewhere");
  assert.equal(isGenesisMint(member.pubkey, flip(410)), false, "a member of another group");
});

test("genesis: findGenesis reads the wallet's Token-2022 accounts with a balance, then their mints", async () => {
  const other = Keypair.generate().publicKey;
  const tokenAccount = (mint, amount) => {
    const data = Buffer.from(holder.account.data);
    mint.toBuffer().copy(data, 0);
    data.writeBigUInt64LE(amount, 64);
    return { pubkey: Keypair.generate().publicKey, account: { ...holder.account, data } };
  };
  const asked = [];
  const chain = (accounts) => ({
    getTokenAccountsByOwner: async (owner, filter) => (assert.ok(owner.equals(WALLET) && filter.programId.equals(TOKEN_2022)), { value: accounts }),
    getMultipleAccountsInfo: async (keys) => {
      asked.push(keys.map((k) => k.toBase58()));
      return keys.map((k) => (k.equals(member.pubkey) ? member.account : k.equals(other) ? group.account : null));
    },
  });
  assert.deepEqual(await findGenesis(chain([holder, tokenAccount(other, 5n)]), WALLET), [member.pubkey.toBase58()]);
  assert.deepEqual(asked.pop().sort(), [member.pubkey.toBase58(), other.toBase58()].sort(), "each held mint read once");
  assert.deepEqual(await findGenesis(chain([tokenAccount(member.pubkey, 0n)]), WALLET), [], "a zero balance doesn't count");
  assert.equal(asked.length, 0, "and no mint is read");
  assert.deepEqual(await findGenesis(chain([holder, holder]), WALLET), [member.pubkey.toBase58()], "a mint in two accounts, once");
});
