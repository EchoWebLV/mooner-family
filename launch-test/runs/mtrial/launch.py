#!/usr/bin/env python3
"""Mooner launch test on Meteora's Dynamic Bonding Curve (DBC).

One wallet is the dev: it creates the token + pool. In the SAME transaction the
dev and two more wallets each buy. Everything lands in one block because it is
one transaction.

Modes
  python3 launch.py                 dry run (default): read-only mainnet checks +
                                    a full rehearsal on a local fork of mainnet
                                    (solana-test-validator with DBC cloned).
                                    Spends nothing.
  python3 launch.py --upload-only   pin image + metadata to IPFS, verify over HTTP.
  python3 launch.py --confirm       run it on mainnet.

Wallets come from a .env: every value that decodes to a Solana secret key
(base58 64-byte, JSON [64 ints], or a path to a keypair .json) is a wallet, in
file order. First = dev, next two = buyers. Point at the file with --env, or put
WALLETS_ENV=/path/to/.env in launch-test/.env. To pick roles by .env name, pass
--wallets dev,buyerA,buyerB or put WALLETS=dev,buyerA,buyerB in launch-test/.env.

Mainnet transactions (--confirm):
  1. create Mooner's DBC config (skipped if it already exists)
  2. wrap each wallet's buy into wSOL
  3. create + fill an address lookup table (makes the big tx fit)
  4. THE LAUNCH: init pool + 3x (create token account, buy) — one tx, 4 signers
  5. cleanup: unwrap leftover wSOL, deactivate the lookup table
"""
import argparse
import base64
import json
import math
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import base58
import requests
from solders.address_lookup_table_account import AddressLookupTableAccount
from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.system_program import TransferParams, transfer
from solders.transaction import VersionedTransaction

sys.path.insert(0, str(Path(__file__).parent))
from dbc_layout import create_config_data, init_pool_data, swap2_data  # noqa: E402

HERE = Path(__file__).parent
MAINNET_RPC = "https://api.mainnet-beta.solana.com"
LAMPORTS = 1_000_000_000

DBC = Pubkey.from_string("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN22 = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
WSOL = Pubkey.from_string("So11111111111111111111111111111111111111112")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
ALT_PROGRAM = Pubkey.from_string("AddressLookupTab1e1111111111111111111111111")
SYSVAR_IX = Pubkey.from_string("Sysvar1nstructions1111111111111111111111111")

POOL_AUTHORITY = Pubkey.find_program_address([b"pool_authority"], DBC)[0]
EVENT_AUTHORITY = Pubkey.find_program_address([b"__event_authority"], DBC)[0]

# ---- the token ---------------------------------------------------------------
TOKEN_INFO = {
    "name": "Mooner Trial",
    "symbol": "MTRIAL",
    "description": "Test token for Mooner's one-transaction launch: the pool is "
                   "created and three wallets buy in the same transaction, on "
                   "Meteora's Dynamic Bonding Curve.",
}

# ---- Mooner's test curve -------------------------------------------------------
# One constant-product segment. Start FDV 28 SOL, graduates at 80 SOL raised,
# ~1B total supply (6 decimals). Flat 1% trading fee. (enable_first_swap_with_min_fee
# lets the first buy in the create tx pay the fee schedule's FLOOR — with a flat
# fee the floor is the same 1%; it only matters with a decaying anti-sniper fee.)
DECIMALS = 6
TOTAL_SUPPLY_RAW = 1_000_000_000 * 10**DECIMALS
START_FDV_SOL = 28
GRAD_QUOTE_SOL = 80
FEE_NUMERATOR = 10_000_000          # 1% (denominator 1e9)
FEE_DENOMINATOR = 1_000_000_000
MAX_SQRT_PRICE = 79226673521066979257578248091
MIN_SQRT_PRICE = 4295048016


def curve_params():
    """sqrt prices are Q64.64 of sqrt(lamports per raw token)."""
    q = GRAD_QUOTE_SOL * LAMPORTS
    t = TOTAL_SUPPLY_RAW
    s0 = math.sqrt(START_FDV_SOL * LAMPORTS / t)
    # sold-on-curve (q / (s0*sm)) + migration base (q / sm^2) = total supply
    a, b = q, q / s0
    x = (-b + math.sqrt(b * b + 4 * a * t)) / (2 * a)       # x = 1/sm
    sm = 1 / x
    p0 = int(s0 * 2**64)
    pm = int(sm * 2**64)
    liquidity = q * 2**128 // (pm - p0)
    assert MIN_SQRT_PRICE <= p0 < pm < MAX_SQRT_PRICE
    return p0, pm, liquidity


def mooner_config():
    p0, _, liq = curve_params()
    zero_vest = dict(vesting_percentage=0, bps_per_period=0, number_of_periods=0,
                     cliff_duration_from_migration_time=0, frequency=0)
    return {
        "pool_fees": {
            "base_fee": dict(cliff_fee_numerator=FEE_NUMERATOR, first_factor=0,
                             second_factor=0, third_factor=0, base_fee_mode=0),
            "dynamic_fee": None,
        },
        "collect_fee_mode": 0,           # fees in SOL
        "migration_option": 1,           # DAMM v2
        "activation_type": 1,            # timestamp
        "token_type": 1,                 # Token-2022
        "token_decimal": DECIMALS,
        "partner_liquidity_percentage": 40,
        "partner_permanent_locked_liquidity_percentage": 10,
        "creator_liquidity_percentage": 40,
        "creator_permanent_locked_liquidity_percentage": 10,
        "migration_quote_threshold": GRAD_QUOTE_SOL * LAMPORTS,
        "sqrt_start_price": p0,
        "locked_vesting": dict(amount_per_period=0, cliff_duration_from_migration_time=0,
                               frequency=0, number_of_period=0, cliff_unlock_amount=0),
        "migration_fee_option": 2,       # graduated pool fee 1%
        "token_supply": None,
        "creator_trading_fee_percentage": 50,
        "token_update_authority": 1,     # immutable metadata
        "migration_fee": dict(fee_percentage=0, creator_fee_percentage=0),
        "migrated_pool_fee": dict(collect_fee_mode=0, dynamic_fee=0, pool_fee_bps=0),
        "pool_creation_fee": 0,
        "partner_liquidity_vesting_info": zero_vest,
        "creator_liquidity_vesting_info": zero_vest,
        "migrated_pool_base_fee_mode": 0,
        "migrated_pool_market_cap_fee_scheduler_params": dict(
            number_of_period=0, sqrt_price_step_bps=0, scheduler_expiration_duration=0,
            reduction_factor=0),
        "enable_first_swap_with_min_fee": True,
        "compounding_fee_bps": 0,
        "padding": [0, 0],
        "curve": [dict(sqrt_price=MAX_SQRT_PRICE, liquidity=liq)],
    }


def estimate_buys(amounts_lamports):
    """Tokens out for sequential buys on a fresh pool (fee taken from SOL input)."""
    p, _, liq = curve_params()
    out = []
    for amt in amounts_lamports:
        net = amt - (amt * FEE_NUMERATOR + FEE_DENOMINATOR - 1) // FEE_DENOMINATOR
        p_new = p + (net << 128) // liq
        out.append(liq * (p_new - p) // (p * p_new))
        p = p_new
    return out


# ---- RPC -------------------------------------------------------------------------
class Rpc:
    def __init__(self, url):
        self.url = url

    def call(self, method, params=None):
        for i in range(12):
            try:
                j = requests.post(self.url, json={"jsonrpc": "2.0", "id": 1, "method": method,
                                                  "params": params or []}, timeout=30).json()
            except Exception:
                time.sleep(1 + i)
                continue
            err = j.get("error")
            if err and err.get("code") in (429, -32429, -32005):
                time.sleep(1.5 * (i + 1))
                continue
            if err:
                raise RuntimeError(f"{method}: {err}")
            return j["result"]
        raise RuntimeError(f"{method}: RPC kept rate-limiting")

    def balance(self, pk):
        return self.call("getBalance", [str(pk), {"commitment": "confirmed"}])["value"]

    def account(self, pk):
        return self.call("getAccountInfo", [str(pk), {"encoding": "base64",
                                                      "commitment": "confirmed"}])["value"]

    def blockhash(self):
        v = self.call("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]
        return Hash.from_string(v["blockhash"]), v["lastValidBlockHeight"]

    def rent(self, size):
        return self.call("getMinimumBalanceForRentExemption", [size])

    def slot(self, commitment="confirmed"):
        return self.call("getSlot", [{"commitment": commitment}])

    def simulate(self, tx):
        return self.call("simulateTransaction", [
            base64.b64encode(bytes(tx)).decode(),
            {"encoding": "base64", "commitment": "confirmed", "sigVerify": True}])["value"]

    def send_and_confirm(self, tx, last_valid, label):
        raw = base64.b64encode(bytes(tx)).decode()
        sig = str(tx.signatures[0])
        self.call("sendTransaction", [raw, {"encoding": "base64", "skipPreflight": False,
                                            "preflightCommitment": "confirmed", "maxRetries": 0}])
        print(f"   sent {label}: {sig}")
        while True:
            st = self.call("getSignatureStatuses", [[sig]])["value"][0]
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                if st.get("err"):
                    raise RuntimeError(f"{label} failed on-chain: {st['err']} ({sig})")
                return sig, st["slot"]
            height = self.call("getBlockHeight", [{"commitment": "confirmed"}])
            if height > last_valid:
                raise RuntimeError(f"{label} expired before landing ({sig})")
            try:
                self.call("sendTransaction", [raw, {"encoding": "base64", "skipPreflight": True,
                                                    "maxRetries": 0}])
            except RuntimeError:
                pass
            time.sleep(1.5)


# ---- wallets from .env -------------------------------------------------------------
def _as_keypair(value):
    v = value.strip().strip('"').strip("'")
    if not v:
        return None
    if "," in v and v.replace(",", "").replace(" ", "").isdigit():
        v = f"[{v}]"                                  # 1,2,3,... without brackets
    if v.startswith("["):
        try:
            arr = json.loads(v)
            if len(arr) == 64:
                return Keypair.from_bytes(bytes(arr))
        except Exception:
            return None
        return None
    p = Path(os.path.expanduser(v))
    if len(v) < 300 and p.suffix == ".json" and p.is_file():
        return _as_keypair(p.read_text())
    try:
        raw = base58.b58decode(v)
    except Exception:
        return None
    if len(raw) == 64:
        try:
            kp = Keypair.from_bytes(raw)
        except Exception:
            return None
        if bytes(kp.pubkey()) == raw[32:]:
            return kp
    return None


def read_env(path):
    out = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.replace("export ", "").strip()
        out.append((k, v.strip().strip('"').strip("'")))
    return out


def load_env(env_path):
    """Returns (wallets [(name, Keypair)], rpc_url | None, pinata_jwt | None)."""
    pairs = []
    local = HERE / ".env"
    if env_path:
        pairs += read_env(env_path)
    elif local.exists():
        pairs += read_env(local)
        pointer = dict(pairs).get("WALLETS_ENV")
        if pointer:
            pairs += read_env(os.path.expanduser(pointer))
    wallets, seen, rpc, pinata = [], set(), None, None
    for k, v in pairs:
        is_array = v.startswith("[") or v.replace(",", "").replace(" ", "").isdigit()
        for piece in [v] if is_array else v.replace(",", " ").split():
            kp = _as_keypair(piece)
            if kp and str(kp.pubkey()) not in seen:
                seen.add(str(kp.pubkey()))
                wallets.append((k, kp))
        if rpc is None and "RPC" in k.upper() and v.startswith("http"):
            rpc = v
        if pinata is None and "PINATA" in k.upper() and "JWT" in k.upper():
            pinata = v
    return wallets, rpc, pinata


# ---- persisted local state (keypairs, token, results) ----------------------------------
def keypair_file(name):
    f = HERE / name
    if f.exists():
        return Keypair.from_bytes(bytes(json.loads(f.read_text())))
    kp = Keypair()
    f.write_text(json.dumps(list(bytes(kp))))
    os.chmod(f, 0o600)
    return kp


def load_state():
    f = HERE / "state.json"
    return json.loads(f.read_text()) if f.exists() else {}


def save_state(s):
    (HERE / "state.json").write_text(json.dumps(s, indent=1))


# ---- image + IPFS ---------------------------------------------------------------------
def make_image(path):
    from PIL import Image, ImageDraw, ImageFilter
    import random
    rnd = random.Random(20260924)
    n = 1024
    img = Image.new("RGB", (n, n))
    px = img.load()
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - n * 0.62, y - n * 0.38) / n
            px[x, y] = (int(14 + 30 * max(0, 0.7 - d)), int(10 + 18 * max(0, 0.7 - d)),
                        int(38 + 70 * max(0, 0.7 - d)))
    draw = ImageDraw.Draw(img)
    for _ in range(420):
        x, y, r = rnd.randrange(n), rnd.randrange(n), rnd.choice([1, 1, 1, 2, 2, 3])
        c = rnd.randint(150, 255)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, min(255, c + 25)))
    glow = Image.new("RGB", (n, n))
    ImageDraw.Draw(glow).ellipse([250, 180, 770, 700], fill=(255, 196, 92))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(90)), 0.35)
    cx, cy, r = 512, 440, 230
    moon = Image.new("RGB", (n, n), (250, 214, 140))
    md = ImageDraw.Draw(moon)
    for ox, oy, cr, shade in [(-80, -60, 46, 222), (70, 40, 62, 214), (-30, 110, 34, 226),
                               (-150, 20, 30, 228), (-60, 170, 22, 230)]:
        md.ellipse([cx + ox - cr, cy + oy - cr, cx + ox + cr, cy + oy + cr],
                   fill=(shade, int(shade * 0.8), int(shade * 0.5)))
    mask = Image.new("L", (n, n), 0)
    mk = ImageDraw.Draw(mask)
    mk.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    mk.ellipse([cx - r + 170, cy - r - 70, cx + r + 170, cy + r - 70], fill=0)   # crescent cut
    img.paste(moon, (0, 0), mask.filter(ImageFilter.GaussianBlur(1.2)))
    draw = ImageDraw.Draw(img)
    draw.arc([90, 700, 934, 900], 190, 350, fill=(255, 196, 92), width=10)
    for i, (x, y) in enumerate([(360, 820), (512, 846), (664, 820)]):
        draw.ellipse([x - 26, y - 26, x + 26, y + 26], fill=(255, 132, 64) if i == 0 else (120, 220, 255))
    img.save(path, "PNG")


def upload_ipfs(image_path, pinata_jwt):
    info = TOKEN_INFO
    if pinata_jwt:
        h = {"Authorization": f"Bearer {pinata_jwt}"}
        with open(image_path, "rb") as f:
            r = requests.post("https://api.pinata.cloud/pinning/pinFileToIPFS", headers=h,
                              files={"file": ("image.png", f, "image/png")}, timeout=120)
        r.raise_for_status()
        image_uri = f"https://ipfs.io/ipfs/{r.json()['IpfsHash']}"
        meta = {"name": info["name"], "symbol": info["symbol"],
                "description": info["description"], "image": image_uri}
        r = requests.post("https://api.pinata.cloud/pinning/pinJSONToIPFS", headers=h,
                          json={"pinataContent": meta}, timeout=60)
        r.raise_for_status()
        return f"https://ipfs.io/ipfs/{r.json()['IpfsHash']}", "pinata"
    with open(image_path, "rb") as f:
        r = requests.post("https://pump.fun/api/ipfs",
                          files={"file": ("image.png", f, "image/png")},
                          data={"name": info["name"], "symbol": info["symbol"],
                                "description": info["description"], "showName": "true"},
                          timeout=120)
    r.raise_for_status()
    return r.json()["metadataUri"], "pump.fun/api/ipfs"


GATEWAYS = ["https://ipfs.io/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/"]


def fetch_ipfs(uri, timeout=40):
    """GET an ipfs URI, falling back across public gateways. Returns (response, url)."""
    cid = uri.rsplit("/ipfs/", 1)[-1]
    for _ in range(4):
        for g in GATEWAYS:
            try:
                r = requests.get(g + cid, timeout=timeout)
                if r.ok:
                    return r, g + cid
            except Exception:
                pass
        time.sleep(3)
    raise RuntimeError(f"{uri} did not resolve on any gateway")


def verify_metadata(uri, image_path):
    r, via = fetch_ipfs(uri)
    meta = r.json()
    if meta.get("name") != TOKEN_INFO["name"] or meta.get("symbol") != TOKEN_INFO["symbol"]:
        raise RuntimeError(f"metadata at {via} is not ours: {meta}")
    img, img_via = fetch_ipfs(meta["image"], timeout=90)
    if img.content != Path(image_path).read_bytes():
        raise RuntimeError(f"image at {img_via} differs from {image_path}")
    return meta, via, img_via


# ---- instruction builders --------------------------------------------------------------
def ata(owner, mint, token_program):
    return Pubkey.find_program_address([bytes(owner), bytes(token_program), bytes(mint)],
                                       ATA_PROGRAM)[0]


def ix_create_ata(payer, owner, mint, token_program):
    return Instruction(ATA_PROGRAM, bytes([1]), [
        AccountMeta(payer, True, True), AccountMeta(ata(owner, mint, token_program), False, True),
        AccountMeta(owner, False, False), AccountMeta(mint, False, False),
        AccountMeta(SYSTEM, False, False), AccountMeta(token_program, False, False)])


def ix_sync_native(account):
    return Instruction(TOKEN, bytes([17]), [AccountMeta(account, False, True)])


def ix_close_account(account, owner):
    return Instruction(TOKEN, bytes([9]), [AccountMeta(account, False, True),
                                           AccountMeta(owner, False, True),
                                           AccountMeta(owner, True, False)])


def pool_addresses(config, mint):
    hi, lo = sorted([bytes(mint), bytes(WSOL)], reverse=True)
    pool = Pubkey.find_program_address([b"pool", bytes(config), hi, lo], DBC)[0]
    base_vault = Pubkey.find_program_address([b"token_vault", bytes(mint), bytes(pool)], DBC)[0]
    quote_vault = Pubkey.find_program_address([b"token_vault", bytes(WSOL), bytes(pool)], DBC)[0]
    return pool, base_vault, quote_vault


def ix_create_config(config, partner, payer, params):
    return Instruction(DBC, create_config_data(params), [
        AccountMeta(config, True, True), AccountMeta(partner, False, False),
        AccountMeta(partner, False, False), AccountMeta(WSOL, False, False),
        AccountMeta(payer, True, True), AccountMeta(SYSTEM, False, False),
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False)])


def ix_init_pool(config, creator, mint, uri):
    pool, bv, qv = pool_addresses(config, mint)
    return Instruction(DBC, init_pool_data(TOKEN_INFO["name"], TOKEN_INFO["symbol"], uri), [
        AccountMeta(config, False, False), AccountMeta(POOL_AUTHORITY, False, False),
        AccountMeta(creator, True, False), AccountMeta(mint, True, True),
        AccountMeta(WSOL, False, False), AccountMeta(pool, False, True),
        AccountMeta(bv, False, True), AccountMeta(qv, False, True),
        AccountMeta(creator, True, True), AccountMeta(TOKEN, False, False),
        AccountMeta(TOKEN22, False, False), AccountMeta(SYSTEM, False, False),
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False)])


def ix_buy(config, mint, buyer, lamports_in, min_out):
    pool, bv, qv = pool_addresses(config, mint)
    return Instruction(DBC, swap2_data(lamports_in, min_out), [
        AccountMeta(POOL_AUTHORITY, False, False), AccountMeta(config, False, False),
        AccountMeta(pool, False, True),
        AccountMeta(ata(buyer, WSOL, TOKEN), False, True),        # input: wSOL
        AccountMeta(ata(buyer, mint, TOKEN22), False, True),      # output: the new token
        AccountMeta(bv, False, True), AccountMeta(qv, False, True),
        AccountMeta(mint, False, False), AccountMeta(WSOL, False, False),
        AccountMeta(buyer, True, False),
        AccountMeta(TOKEN22, False, False), AccountMeta(TOKEN, False, False),
        AccountMeta(DBC, False, False),                            # referral: none
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False),
        AccountMeta(SYSVAR_IX, False, False)])                     # enables min-fee first buy


def ix_alt_create(authority, recent_slot):
    table, bump = Pubkey.find_program_address([bytes(authority), recent_slot.to_bytes(8, "little")],
                                              ALT_PROGRAM)
    data = (0).to_bytes(4, "little") + recent_slot.to_bytes(8, "little") + bytes([bump])
    return table, Instruction(ALT_PROGRAM, data, [
        AccountMeta(table, False, True), AccountMeta(authority, True, False),
        AccountMeta(authority, True, True), AccountMeta(SYSTEM, False, False)])


def ix_alt_extend(table, authority, addresses):
    data = (2).to_bytes(4, "little") + len(addresses).to_bytes(8, "little") + \
        b"".join(bytes(a) for a in addresses)
    return Instruction(ALT_PROGRAM, data, [
        AccountMeta(table, False, True), AccountMeta(authority, True, False),
        AccountMeta(authority, True, True), AccountMeta(SYSTEM, False, False)])


def ix_alt_deactivate(table, authority):
    return Instruction(ALT_PROGRAM, (3).to_bytes(4, "little"), [
        AccountMeta(table, False, True), AccountMeta(authority, True, False)])


def build_tx(rpc, payer, ixs, signers, alts=(), cu_limit=None, cu_price=None):
    pre = []
    if cu_limit:
        pre.append(set_compute_unit_limit(cu_limit))
    if cu_price:
        pre.append(set_compute_unit_price(cu_price))
    bh, last_valid = rpc.blockhash()
    msg = MessageV0.try_compile(payer, pre + ixs, list(alts), bh)
    required = set(msg.account_keys[:msg.header.num_required_signatures])
    return VersionedTransaction(msg, [s for s in signers if s.pubkey() in required]), last_valid


# ---- the run -------------------------------------------------------------------------
def run(rpc, dev, buyers, buys, config_kp, mint_kp, uri, cu_price, log):
    """Executes steps 1-5 against `rpc`. Returns a result dict."""
    wallets = [dev] + buyers
    config, mint = config_kp.pubkey(), mint_kp.pubkey()
    res = {"rpc": rpc.url, "mint": str(mint), "config": str(config)}

    if rpc.account(mint) is not None:
        raise RuntimeError(f"mint {mint} already exists on this chain — this token was already launched")

    # 1. config
    if rpc.account(config) is None:
        tx, lv = build_tx(rpc, dev.pubkey(), [ix_create_config(config, dev.pubkey(), dev.pubkey(),
                                                               mooner_config())],
                          [dev, config_kp], cu_price=cu_price, cu_limit=200_000)
        res["config_sig"], _ = rpc.send_and_confirm(tx, lv, "1/5 create config")
    else:
        log("   1/5 config already exists — reusing it")

    # 2. wrap SOL -> wSOL for each buyer
    wrap = []
    for w, amt in zip(wallets, buys):
        if amt:
            w_ata = ata(w.pubkey(), WSOL, TOKEN)
            wrap += [ix_create_ata(w.pubkey(), w.pubkey(), WSOL, TOKEN),
                     transfer(TransferParams(from_pubkey=w.pubkey(), to_pubkey=w_ata, lamports=amt)),
                     ix_sync_native(w_ata)]
    tx, lv = build_tx(rpc, dev.pubkey(), wrap, wallets, cu_price=cu_price, cu_limit=150_000)
    res["wrap_sig"], _ = rpc.send_and_confirm(tx, lv, "2/5 wrap SOL")

    try:
        # 3. lookup table
        pool, bv, qv = pool_addresses(config, mint)
        addrs = [POOL_AUTHORITY, config, pool, bv, qv, WSOL, TOKEN, TOKEN22, SYSTEM,
                 EVENT_AUTHORITY, SYSVAR_IX]
        for w in wallets:
            addrs += [ata(w.pubkey(), WSOL, TOKEN), ata(w.pubkey(), mint, TOKEN22)]
        recent = rpc.slot("finalized")
        table, ix_c = ix_alt_create(dev.pubkey(), recent)
        tx, lv = build_tx(rpc, dev.pubkey(), [ix_c, ix_alt_extend(table, dev.pubkey(), addrs)],
                          [dev], cu_price=cu_price, cu_limit=50_000)
        res["alt"] = str(table)
        res["alt_sig"], alt_slot = rpc.send_and_confirm(tx, lv, "3/5 lookup table")
        while rpc.slot() <= alt_slot + 1:
            time.sleep(0.4)

        # 4. THE LAUNCH: create + all buys, one transaction
        est = estimate_buys([a for a in buys if a])
        ixs = [ix_init_pool(config, dev.pubkey(), mint, uri)]
        k = 0
        for w, amt in zip(wallets, buys):
            ixs.append(ix_create_ata(w.pubkey(), w.pubkey(), mint, TOKEN22))
            if amt:
                ixs.append(ix_buy(config, mint, w.pubkey(), amt, est[k] * 9 // 10))
                k += 1
        signers = [dev, mint_kp] + buyers
        tx, lv = build_tx(rpc, dev.pubkey(), ixs, signers,
                          alts=[AddressLookupTableAccount(table, addrs)],
                          cu_limit=400_000, cu_price=cu_price)      # rehearsal used ~222k
        res["launch_tx_bytes"] = len(bytes(tx))
        log(f"   launch tx: {len(ixs)} instructions, {len(signers)} signers, "
            f"{res['launch_tx_bytes']} / 1232 bytes")
        res["launch_sig"], res["launch_slot"] = rpc.send_and_confirm(tx, lv, "4/5 LAUNCH")
    finally:
        # 5. cleanup — runs even if the launch failed, so wrapped SOL comes back
        clean = [ix_close_account(ata(w.pubkey(), WSOL, TOKEN), w.pubkey())
                 for w, amt in zip(wallets, buys) if amt]
        if res.get("alt"):
            clean.append(ix_alt_deactivate(Pubkey.from_string(res["alt"]), dev.pubkey()))
        try:
            tx, lv = build_tx(rpc, dev.pubkey(), clean, wallets, cu_price=cu_price, cu_limit=100_000)
            res["cleanup_sig"], _ = rpc.send_and_confirm(tx, lv, "5/5 cleanup")
        except Exception as e:  # noqa: BLE001
            log(f"   cleanup failed: {e}")

    # verify
    t = rpc.call("getTransaction", [res["launch_sig"], {"encoding": "json", "commitment": "confirmed",
                                                         "maxSupportedTransactionVersion": 0}])
    logs = t["meta"]["logMessages"]
    res["launch_cu"] = t["meta"].get("computeUnitsConsumed")
    res["launch_fee_lamports"] = t["meta"]["fee"]
    res["swaps_in_launch_tx"] = sum(1 for l in logs if l.endswith("Instruction: Swap2"))
    res["init_in_launch_tx"] = any("InitializeVirtualPoolWithToken2022" in l for l in logs)
    got = []
    for w in wallets:
        a = ata(w.pubkey(), mint, TOKEN22)
        bal = rpc.call("getTokenAccountBalance", [str(a), {"commitment": "confirmed"}])["value"]
        got.append(int(bal["amount"]))
    res["tokens_received_raw"] = got
    res["tokens_estimated_raw"] = est
    return res


# ---- local mainnet fork --------------------------------------------------------------------
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class LocalFork:
    """solana-test-validator with the live DBC program cloned from mainnet."""

    def __init__(self, source_rpc):
        self.dir = tempfile.mkdtemp(prefix="mooner-fork-")
        self.port = free_port()
        cmd = ["solana-test-validator", "--reset", "--quiet", "--ledger", self.dir,
               "--rpc-port", str(self.port), "--faucet-port", str(free_port()),
               "--gossip-port", str(free_port()), "--dynamic-port-range",
               f"{self.port + 10}-{self.port + 40}",
               "--url", source_rpc, "--clone-upgradeable-program", str(DBC)]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                     start_new_session=True)
        self.rpc = Rpc(f"http://127.0.0.1:{self.port}")
        for _ in range(120):
            if self.proc.poll() is not None:
                raise RuntimeError("local validator exited: " + self.proc.stderr.read().decode()[-800:])
            try:
                if requests.post(self.rpc.url, json={"jsonrpc": "2.0", "id": 1, "method": "getHealth"},
                                 timeout=2).json().get("result") == "ok":
                    break
            except Exception:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("local validator did not become healthy")

    def fund(self, pk, sol):
        sig = self.rpc.call("requestAirdrop", [str(pk), int(sol * LAMPORTS)])
        for _ in range(60):
            st = self.rpc.call("getSignatureStatuses", [[sig]])["value"][0]
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                return
            time.sleep(0.5)
        raise RuntimeError("local airdrop did not confirm")

    def close(self):
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(timeout=20)
        except Exception:
            pass
        shutil.rmtree(self.dir, ignore_errors=True)


# ---- main ------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--confirm", action="store_true", help="run on mainnet")
    mode.add_argument("--upload-only", action="store_true", help="pin image + metadata to IPFS")
    ap.add_argument("--env", help="path to the .env holding the wallets")
    ap.add_argument("--rpc", help="mainnet RPC (default: RPC from .env, else public mainnet)")
    ap.add_argument("--buy", type=float, default=0.1, help="SOL each of the 3 wallets buys (default 0.1)")
    ap.add_argument("--dev-buy", type=float, help="SOL the dev buys (default: same as --buy; 0 = none)")
    ap.add_argument("--priority", type=int, default=200_000, help="priority fee, micro-lamports per CU")
    ap.add_argument("--wallets", help="comma-separated .env names for dev,buyerA,buyerB "
                                      "(default: WALLETS in launch-test/.env, else first 3 in file order)")
    ap.add_argument("--throwaway", action="store_true",
                    help="dry run with 3 generated wallets instead of the .env (rehearsal only)")
    args = ap.parse_args()

    state = load_state()
    mint_kp = keypair_file("mint-keypair.json")
    config_kp = keypair_file("config-keypair.json")
    print(f"Token     {TOKEN_INFO['name']} (${TOKEN_INFO['symbol']})")
    print(f"CA (mint) {mint_kp.pubkey()}")
    print(f"Config    {config_kp.pubkey()}  (Mooner partner config on DBC)")

    image = HERE / "image.png"
    if not image.exists():
        make_image(image)
        print(f"Image     {image} (1024x1024, generated)")

    wallets, env_rpc, pinata = ([], None, None)
    if not args.throwaway:
        try:
            wallets, env_rpc, pinata = load_env(args.env)
        except FileNotFoundError as e:
            print(f"!! .env not found: {e.filename}")

    # --upload-only ---------------------------------------------------------------
    if args.upload_only:
        uri, via = upload_ipfs(image, pinata)
        meta, meta_via, img_via = verify_metadata(uri, image)
        state.update(metadata_uri=uri, image_uri=meta["image"], pinned_via=via)
        save_state(state)
        print(f"Metadata  {uri}  (pinned via {via}; resolved at {meta_via})")
        print(f"Image     {meta['image']}  (resolved at {img_via}, identical to image.png)")
        return

    uri = state.get("metadata_uri")
    if not uri:
        sys.exit("No metadata yet. Run: python3 launch.py --upload-only")

    pick = args.wallets
    if pick is None and (HERE / ".env").exists():
        pick = dict(read_env(HERE / ".env")).get("WALLETS")
    if pick and not args.throwaway:
        names = [n.strip() for n in pick.split(",") if n.strip()]
        by_name = dict(wallets)
        missing = [n for n in names if n not in by_name]
        if len(names) != 3 or missing:
            sys.exit(f"--wallets/WALLETS needs 3 names from the .env; "
                     f"unknown: {missing or '-'}; available: {', '.join(n for n, _ in wallets)}")
        wallets = [(n, by_name[n]) for n in names]
    if args.throwaway:
        wallets = [(f"THROWAWAY_{i}", Keypair()) for i in range(3)]
    if len(wallets) < 3:
        where = args.env or (HERE / ".env")
        sys.exit(f"Need 3 wallets, found {len(wallets)} in {where}. "
                 "Use --env /path/to/.env or WALLETS_ENV=... in launch-test/.env")
    if len(wallets) > 3:
        print(f"   ({len(wallets)} keys in .env — using the first 3)")
    (dn, dev), (an, a), (bn, b) = wallets[:3]
    buyers = [a, b]
    dev_buy = args.buy if args.dev_buy is None else args.dev_buy
    buys = [int(round(dev_buy * LAMPORTS)), int(round(args.buy * LAMPORTS)),
            int(round(args.buy * LAMPORTS))]
    print(f"Dev       {dev.pubkey()}  [{dn}]  buys {buys[0] / LAMPORTS} SOL")
    print(f"Buyer A   {a.pubkey()}  [{an}]  buys {buys[1] / LAMPORTS} SOL")
    print(f"Buyer B   {b.pubkey()}  [{bn}]  buys {buys[2] / LAMPORTS} SOL")
    est = estimate_buys([x for x in buys if x])
    print("Estimate  " + ", ".join(f"{e / 10**DECIMALS:,.0f}" for e in est) + " tokens (in order)")

    mainnet = Rpc(args.rpc or env_rpc or MAINNET_RPC)

    # rough SOL each wallet needs (rent from the chain; fees padded)
    r_tok, r_t22 = mainnet.rent(165), mainnet.rent(170)
    need_dev = buys[0] + r_tok + r_t22 + mainnet.rent(1048 + 8) + mainnet.rent(424 + 8) \
        + 2 * r_tok + mainnet.rent(500) + mainnet.rent(56 + 32 * 17) + 5_000_000
    need_buyer = [x + r_tok + r_t22 + 1_000_000 for x in buys[1:]]
    needs = [need_dev] + need_buyer

    if args.confirm:
        if args.throwaway:
            sys.exit("--throwaway is rehearsal-only")
        short = [(w, n) for w, n in zip([dev, a, b], needs) if mainnet.balance(w.pubkey()) < n]
        for w, n in short:
            print(f"!! {w.pubkey()} needs ~{n / LAMPORTS:.4f} SOL")
        if short:
            sys.exit("Not enough SOL — nothing was sent.")
        print(f"\nMAINNET via {mainnet.url}")
        res = run(mainnet, dev, buyers, buys, config_kp, mint_kp, uri, args.priority, print)
        state.setdefault("mainnet", {}).update(res)
        save_state(state)
        report(res, mainnet=True)
        return

    # dry run ---------------------------------------------------------------------------
    print(f"\nDRY RUN — mainnet checks via {mainnet.url}")
    prog = mainnet.account(DBC)
    print(f"   DBC program on mainnet: {'yes' if prog and prog['executable'] else 'NO'}")
    print(f"   mint unused on mainnet: {'yes' if mainnet.account(mint_kp.pubkey()) is None else 'NO — already exists'}")
    print(f"   config on mainnet: {'exists (will reuse)' if mainnet.account(config_kp.pubkey()) else 'not yet (step 1 creates it)'}")
    for (name, w), n in zip(wallets[:3], needs):
        bal = mainnet.balance(w.pubkey())
        flag = "ok" if bal >= n else "SHORT"
        print(f"   {str(w.pubkey())[:8]}… balance {bal / LAMPORTS:.4f} SOL, needs ~{n / LAMPORTS:.4f}  {flag}")
    if mainnet.account(config_kp.pubkey()) is None:
        tx, _ = build_tx(mainnet, dev.pubkey(), [ix_create_config(config_kp.pubkey(), dev.pubkey(),
                                                                  dev.pubkey(), mooner_config())],
                         [dev, config_kp], cu_limit=200_000)
        sim = mainnet.simulate(tx)
        print(f"   step 1 simulated on mainnet: {'ok' if not sim['err'] else sim['err']}"
              + (f" ({sim.get('unitsConsumed')} CU)" if not sim["err"] else ""))
        if sim["err"]:
            print("   " + "\n   ".join((sim.get("logs") or [])[-8:]))

    if not shutil.which("solana-test-validator"):
        print("\n(solana-test-validator not installed — skipping the local rehearsal)")
        return
    print("\nREHEARSAL on a local mainnet fork (DBC cloned from mainnet, SOL airdropped locally)")
    fork = LocalFork(mainnet.url if "127.0.0.1" not in mainnet.url else MAINNET_RPC)
    try:
        for w in (dev, a, b):
            fork.fund(w.pubkey(), 2)
        res = run(fork.rpc, dev, buyers, buys, config_kp, mint_kp, uri, args.priority, print)
    finally:
        fork.close()
    state["rehearsal"] = res
    save_state(state)
    report(res, mainnet=False)


def report(res, mainnet):
    ok = res["init_in_launch_tx"] and res["swaps_in_launch_tx"] == sum(1 for x in res["tokens_received_raw"] if x)
    print(f"\n{'MAINNET' if mainnet else 'REHEARSAL'} RESULT: {'PASS' if ok else 'CHECK'}")
    print(f"   launch tx   {res['launch_sig']}  (slot {res['launch_slot']})")
    print(f"   in that tx  pool created: {res['init_in_launch_tx']}, buys: {res['swaps_in_launch_tx']}")
    print(f"   size / CU   {res['launch_tx_bytes']} bytes, {res['launch_cu']} CU, fee {res['launch_fee_lamports']} lamports")
    for i, (got, est) in enumerate(zip(res["tokens_received_raw"], res["tokens_estimated_raw"] + [0] * 3)):
        print(f"   wallet {i}    got {got / 10**DECIMALS:,.2f} tokens (estimated {est / 10**DECIMALS:,.2f})")
    if mainnet:
        print(f"   https://solscan.io/tx/{res['launch_sig']}")
        print(f"   https://solscan.io/token/{res['mint']}")


if __name__ == "__main__":
    main()
