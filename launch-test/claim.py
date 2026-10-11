#!/usr/bin/env python3
"""Claim everything the dev wallet is owed from the Mooner test launches.

For each mainnet run recorded in state.json and runs/*/state.json:
  - the partner trading fee (the dev is the config's fee_claimer) and
  - the creator trading fee (the dev created the pool),
paid out to the dev's wSOL account, then unwrapped to plain SOL in the same tx.
Also closes the runs' deactivated address lookup tables and returns their rent.

Modes
  python3 claim.py             dry run (default): reads the pools and simulates
                               every claim tx on mainnet. Sends nothing.
  python3 claim.py --confirm   sends the claim txs on mainnet.

The dev wallet is the first name in WALLETS in launch-test/.env (same as launch.py).
"""
import argparse
import base64
import hashlib
import json
import struct
import sys
from pathlib import Path

from solders.instruction import AccountMeta, Instruction
from solders.pubkey import Pubkey

sys.path.insert(0, str(Path(__file__).parent))
from launch import (ALT_PROGRAM, DBC, EVENT_AUTHORITY, HERE, LAMPORTS, MAINNET_RPC,  # noqa: E402
                    POOL_AUTHORITY, TOKEN, TOKEN22, WSOL, Rpc, ata, build_tx,
                    ix_close_account, ix_create_ata, load_env, pool_addresses, read_env)

U64_MAX = 2**64 - 1
ALT_DEACTIVATION_SLOTS = 513  # a deactivated table can be closed once it is older than the slot-hash window


def disc(name):
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


def read_pool(rpc, pool):
    """Fields of DBC's PoolState (state/virtual_pool.rs), after the 8-byte discriminator."""
    acc = rpc.account(pool)
    if acc is None:
        return None
    d = base64.b64decode(acc["data"][0])
    f = dict(creator=Pubkey.from_bytes(d[104:136]), base_mint=Pubkey.from_bytes(d[136:168]),
             base_vault=Pubkey.from_bytes(d[168:200]), quote_vault=Pubkey.from_bytes(d[200:232]),
             pool_type=d[304])
    (f["partner_base_fee"], f["partner_quote_fee"]) = struct.unpack_from("<QQ", d, 264)
    (f["creator_base_fee"], f["creator_quote_fee"]) = struct.unpack_from("<QQ", d, 352)
    return f


def fee_claimer(rpc, config):
    d = base64.b64decode(rpc.account(config)["data"][0])
    return Pubkey.from_bytes(d[40:72])


def ix_claim_partner(config, pool, p, dev, base_program):
    return Instruction(DBC, disc("claim_trading_fee") + struct.pack("<QQ", U64_MAX, U64_MAX), [
        AccountMeta(POOL_AUTHORITY, False, False), AccountMeta(config, False, False),
        AccountMeta(pool, False, True),
        AccountMeta(ata(dev, p["base_mint"], base_program), False, True),
        AccountMeta(ata(dev, WSOL, TOKEN), False, True),
        AccountMeta(p["base_vault"], False, True), AccountMeta(p["quote_vault"], False, True),
        AccountMeta(p["base_mint"], False, False), AccountMeta(WSOL, False, False),
        AccountMeta(dev, True, False),
        AccountMeta(base_program, False, False), AccountMeta(TOKEN, False, False),
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False)])


def ix_claim_creator(pool, p, dev, base_program):
    return Instruction(DBC, disc("claim_creator_trading_fee") + struct.pack("<QQ", U64_MAX, U64_MAX), [
        AccountMeta(POOL_AUTHORITY, False, False), AccountMeta(pool, False, True),
        AccountMeta(ata(dev, p["base_mint"], base_program), False, True),
        AccountMeta(ata(dev, WSOL, TOKEN), False, True),
        AccountMeta(p["base_vault"], False, True), AccountMeta(p["quote_vault"], False, True),
        AccountMeta(p["base_mint"], False, False), AccountMeta(WSOL, False, False),
        AccountMeta(dev, True, False),
        AccountMeta(base_program, False, False), AccountMeta(TOKEN, False, False),
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False)])


def ix_alt_close(table, authority):
    return Instruction(ALT_PROGRAM, (4).to_bytes(4, "little"), [
        AccountMeta(table, False, True), AccountMeta(authority, True, False),
        AccountMeta(authority, False, True)])


def runs():
    files = [HERE / "state.json"] + sorted((HERE / "runs").glob("*/state.json"))
    for f in files:
        if f.exists():
            m = json.loads(f.read_text()).get("mainnet")
            if m and m.get("mint") and m.get("config"):
                yield f.parent.name if f.parent != HERE else "current", m


def simulate(rpc, tx, dev):
    v = rpc.call("simulateTransaction", [
        base64.b64encode(bytes(tx)).decode(),
        {"encoding": "base64", "commitment": "confirmed", "sigVerify": True,
         "accounts": {"encoding": "base64", "addresses": [str(dev)]}}])["value"]
    after = v["accounts"][0]["lamports"] if v.get("accounts") and v["accounts"][0] else None
    return v["err"], v.get("logs") or [], after


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirm", action="store_true", help="send the claim txs on mainnet")
    ap.add_argument("--env", help="path to the .env holding the wallets")
    ap.add_argument("--rpc", help="mainnet RPC (default: RPC from .env, else public mainnet)")
    ap.add_argument("--priority", type=int, default=50_000, help="priority fee, micro-lamports per CU")
    args = ap.parse_args()

    wallets, env_rpc, _ = load_env(args.env)
    by_name = dict(wallets)
    pick = dict(read_env(HERE / ".env")).get("WALLETS") if (HERE / ".env").exists() else None
    dev_name = pick.split(",")[0].strip() if pick else (wallets[0][0] if wallets else None)
    if dev_name not in by_name:
        sys.exit(f"dev wallet '{dev_name}' not found in the .env")
    dev = by_name[dev_name]
    rpc = Rpc(args.rpc or env_rpc or MAINNET_RPC)
    start = rpc.balance(dev.pubkey())
    print(f"Dev       {dev.pubkey()}  [{dev_name}]  {start / LAMPORTS:.9f} SOL")
    print(f"RPC       {rpc.url}\n")

    txs = []   # (label, ixs, expected lamports back)
    slot = rpc.slot("finalized")
    for name, m in runs():
        config, mint = Pubkey.from_string(m["config"]), Pubkey.from_string(m["mint"])
        pool = pool_addresses(config, mint)[0]
        p = read_pool(rpc, pool)
        if p is None:
            print(f"[{name}] pool {pool} not found, skipped")
            continue
        base_program = TOKEN22 if p["pool_type"] == 1 else TOKEN
        is_claimer = fee_claimer(rpc, config) == dev.pubkey()
        is_creator = p["creator"] == dev.pubkey()
        print(f"[{name}] mint {mint}\n          pool {pool}")
        print(f"          partner fee  {p['partner_quote_fee'] / LAMPORTS:.9f} SOL + {p['partner_base_fee']} raw tokens"
              f"  (dev is fee claimer: {is_claimer})")
        print(f"          creator fee  {p['creator_quote_fee'] / LAMPORTS:.9f} SOL + {p['creator_base_fee']} raw tokens"
              f"  (dev is creator: {is_creator})")
        ixs, owed = [], 0
        if is_claimer and (p["partner_quote_fee"] or p["partner_base_fee"]):
            ixs.append(ix_claim_partner(config, pool, p, dev.pubkey(), base_program))
            owed += p["partner_quote_fee"]
        if is_creator and (p["creator_quote_fee"] or p["creator_base_fee"]):
            ixs.append(ix_claim_creator(pool, p, dev.pubkey(), base_program))
            owed += p["creator_quote_fee"]
        if ixs:
            wsol_acc = ata(dev.pubkey(), WSOL, TOKEN)
            pre = [ix_create_ata(dev.pubkey(), dev.pubkey(), WSOL, TOKEN),
                   ix_create_ata(dev.pubkey(), dev.pubkey(), p["base_mint"], base_program)]
            ixs = pre + ixs + [ix_close_account(wsol_acc, dev.pubkey())]  # unwrap wSOL -> SOL
            txs.append((f"claim {name}", ixs, owed))

    alt_ixs, alt_back = [], 0
    for name, m in runs():
        if not m.get("alt"):
            continue
        table = Pubkey.from_string(m["alt"])
        acc = rpc.account(table)
        if acc is None:
            print(f"[{name}] lookup table {table} already closed")
            continue
        d = base64.b64decode(acc["data"][0])
        deact = struct.unpack_from("<Q", d, 4)[0]
        auth = Pubkey.from_bytes(d[22:54]) if d[21] == 1 else None
        ok = auth == dev.pubkey() and deact != U64_MAX and slot - deact > ALT_DEACTIVATION_SLOTS
        print(f"[{name}] lookup table {table}  {acc['lamports'] / LAMPORTS:.9f} SOL  "
              f"{'closable' if ok else 'NOT closable yet'}")
        if ok:
            alt_ixs.append(ix_alt_close(table, dev.pubkey()))
            alt_back += acc["lamports"]
    if alt_ixs:
        txs.append(("close lookup tables", alt_ixs, alt_back))

    if not txs:
        print("\nNothing to claim.")
        return
    total = sum(t[2] for t in txs)
    print(f"\nOwed to the dev: {total / LAMPORTS:.9f} SOL across {len(txs)} tx(s), minus network fees\n")

    for label, ixs, owed in txs:
        tx, last_valid = build_tx(rpc, dev.pubkey(), ixs, [dev], cu_limit=200_000, cu_price=args.priority)
        if not args.confirm:
            err, logs, after = simulate(rpc, tx, dev.pubkey())
            if err:
                print(f"   simulate {label}: FAILED {err}")
                print("      " + "\n      ".join(logs[-8:]))
                sys.exit(1)
            delta = (after - rpc.balance(dev.pubkey())) if after is not None else None
            print(f"   simulate {label}: ok, dev balance change {delta / LAMPORTS:+.9f} SOL"
                  if delta is not None else f"   simulate {label}: ok")
            continue
        rpc.send_and_confirm(tx, last_valid, label)

    end = rpc.balance(dev.pubkey())
    if args.confirm:
        print(f"\nDev balance {start / LAMPORTS:.9f} -> {end / LAMPORTS:.9f} SOL "
              f"({(end - start) / LAMPORTS:+.9f})")
        for name, m in runs():
            config, mint = Pubkey.from_string(m["config"]), Pubkey.from_string(m["mint"])
            p = read_pool(rpc, pool_addresses(config, mint)[0])
            if p:
                print(f"   [{name}] left in pool: partner {p['partner_quote_fee'] / LAMPORTS:.9f} SOL, "
                      f"creator {p['creator_quote_fee'] / LAMPORTS:.9f} SOL")
    else:
        print("\nDRY RUN — nothing sent.")


if __name__ == "__main__":
    main()
