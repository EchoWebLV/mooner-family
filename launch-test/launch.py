#!/usr/bin/env python3
"""Mooner presale-vault launch test on Meteora's Dynamic Bonding Curve (DBC).

A smart contract holds the presale, not a wallet (presale-program/, "the Mooner
presale program"):
  - each buyer deposits SOL into the contract, from their own wallet, in their own tx
  - at launch ONE tx creates the pool, the contract releases the pooled SOL to
    Mooner's operator key, the operator makes ONE buy whose tokens land straight in
    the contract's vault, and the contract checks that buy or the whole tx reverts
  - each buyer claims their pro-rata share from the contract, in their own tx
Everyone gets exactly the same entry price. No participant sends SOL or tokens to
another participant or to a shared wallet: what they have in common is the program.

Anti-sniper: a snipe tax shaped like pons v2's. The pool's fee starts at ~99% and
falls exponentially to the 1% floor within SNIPE_S seconds (98.95%, 21.39%, 4.63%,
then 1%). The presale buy is the pool's first swap inside the create tx, so it only
pays the 1% floor (enable_first_swap_with_min_fee).

Modes
  python3 launch.py                 dry run (default): read-only mainnet checks +
                                    a full rehearsal on a local fork of mainnet
                                    (DBC cloned, our program deployed there, SOL
                                    airdropped) with a sniper, plus checks that the
                                    contract rejects bad calls. Spends nothing.
  python3 launch.py --upload-only   pin image + metadata to IPFS, verify over HTTP.
  python3 launch.py --confirm       run it on mainnet.

Wallets: WALLETS=dev,buyer,... in launch-test/.env (names from the .env that
WALLETS_ENV points at), or --wallets. First = dev (pool creator). Each wallet
deposits --contrib SOL (one value for all, or one per wallet). --throwaway N
rehearses with N generated wallets instead.

Mainnet transactions (--confirm); a re-run skips whatever is already done:
  1. dev tops up Mooner's operator key (operator-keypair.json)
  2. the operator deploys the presale program (solana program deploy)
  3. Mooner's DBC config with the anti-sniper fee (reused: it exists)
  4. the operator opens the presale for this mint (the mint key co-signs)
  5. each wallet deposits, one tx per wallet
  6. THE LAUNCH, one tx: create pool -> release -> one buy into the vault -> settle
  7. each wallet claims its share, one tx per wallet
"""
import argparse
import base64
import functools
import json
import math
import os
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import base58
import requests
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
    "name": "Mooner Vault",
    "symbol": "MVAULT",
    "description": "Test token for Mooner's presale vault on Meteora's Dynamic Bonding "
                   "Curve. Presale buyers deposit into a contract; the contract's SOL makes "
                   "one buy in the same transaction that creates the pool; every buyer "
                   "claims their share from the contract at the same price.",
}

# ---- the presale program -------------------------------------------------------
PROGRAM_DIR = HERE / "presale-program"
PROGRAM_SO = PROGRAM_DIR / "target" / "deploy" / "mooner_presale.so"
PROGRAM_KEYPAIR = "presale-program-keypair.json"   # its pubkey is the program id
OPERATOR_KEYPAIR = "operator-keypair.json"         # Mooner's key: deploys, opens presales, makes the buy
BUFFER_KEYPAIR = "deploy-buffer-keypair.json"      # lets an interrupted deploy resume
PRESALE_LEN, RECEIPT_LEN = 144, 48
OPEN, LAUNCHING, SETTLED = 0, 1, 2
STATE_NAMES = {OPEN: "open", LAUNCHING: "launching", SETTLED: "settled"}
CAP_SOL = 1                                         # max SOL per wallet in the presale
TX_LIMIT = 1232


# ---- Mooner's test curve -------------------------------------------------------
# One constant-product segment. Start FDV 28 SOL, graduates at 80 SOL raised,
# ~1B total supply (6 decimals).
# Fee: a snipe tax on DBC's exponential scheduler, 98.95% in the pool's first second,
# then x(1 - 7838/10000) each second, exactly the 1% floor from SNIPE_S on. The first
# swap inside the create tx pays the floor (enable_first_swap_with_min_fee;
# DBC requires it to be a top-level swap, not a CPI, with the init ix earlier in
# the same tx and the instructions sysvar passed).
DECIMALS = 6
TOTAL_SUPPLY_RAW = 1_000_000_000 * 10**DECIMALS
START_FDV_SOL = 28
GRAD_QUOTE_SOL = 80
FEE_DENOMINATOR = 1_000_000_000
FEE_NUMERATOR = 10_000_000          # 1% floor: what the presale buy pays, and the fee after the window
MAX_FEE_NUMERATOR = 990_000_000     # DBC's cap (99%)
SNIPE_S = 3                         # seconds from pool creation until the fee is back at 1%
FEE_REDUCTION_BPS = 7838            # each second keeps 1 - 7838/10000 of the fee
FEE_CLIFF = 989_539_134             # the largest cliff <= 99% whose third second is exactly 1%
ONE_Q64 = 1 << 64


def fee_at(seconds_after_creation):
    """Base fee numerator DBC charges a normal swap at this point: cliff * (1 - R)^period,
    in Q64.64 with DBC's truncating square-and-multiply."""
    period = min(max(0, int(seconds_after_creation)), SNIPE_S)
    sq = ONE_Q64 - (FEE_REDUCTION_BPS << 64) // 10_000
    q = ONE_Q64
    bit = 1
    while bit <= period:
        if period & bit:
            q = (q * sq) >> 64
        sq = (sq * sq) >> 64
        bit <<= 1
    return (q * FEE_CLIFF) >> 64


assert fee_at(SNIPE_S) == FEE_NUMERATOR and fee_at(0) <= MAX_FEE_NUMERATOR
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
            # FeeSchedulerExponential: number_of_period, period_frequency (s), reduction_factor (bps)
            "base_fee": dict(cliff_fee_numerator=FEE_CLIFF, first_factor=SNIPE_S,
                             second_factor=1, third_factor=FEE_REDUCTION_BPS, base_fee_mode=1),
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


def curve_buy(p, amt, fee_numerator):
    """One buy of `amt` lamports at sqrt price p. Returns (new sqrt price, raw tokens out)."""
    _, _, liq = curve_params()
    net = amt - (amt * fee_numerator + FEE_DENOMINATOR - 1) // FEE_DENOMINATOR
    p_new = p + (net << 128) // liq
    return p_new, liq * (p_new - p) // (p * p_new)


def implied_fee(p, amt, tokens_out):
    """Fee numerator that turns `amt` lamports into `tokens_out` at sqrt price p."""
    lo, hi = 0, MAX_FEE_NUMERATOR + 1
    while lo < hi:                              # smallest fee whose output <= tokens_out
        mid = (lo + hi) // 2
        if curve_buy(p, amt, mid)[1] <= tokens_out:
            hi = mid
        else:
            lo = mid + 1
    return lo


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
    """A round vault door with the full moon behind its window: the presale sits in a contract."""
    from PIL import Image, ImageDraw, ImageFilter
    import random
    rnd = random.Random(20260926)
    n, s = 1024, 2                              # draw at 2x, downsample for smooth edges
    N = n * s
    bg = Image.new("RGB", (n, n))
    px = bg.load()
    for y in range(n):
        for x in range(n):
            k = max(0.0, 0.8 - math.hypot(x - n / 2, y - n / 2) / n)
            px[x, y] = (int(6 + 26 * k), int(10 + 34 * k), int(24 + 70 * k))
    img = bg.resize((N, N))
    d = ImageDraw.Draw(img)
    for _ in range(520):
        x, y, r = rnd.randrange(N), rnd.randrange(N), rnd.choice([2, 2, 2, 3, 4, 5])
        c = rnd.randint(150, 255)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, min(255, c + 25)))
    cx = cy = N // 2
    glow = Image.new("RGB", (N, N))
    ImageDraw.Draw(glow).ellipse([cx - 880, cy - 880, cx + 880, cy + 880], fill=(120, 170, 230))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(140)), 0.22)
    d = ImageDraw.Draw(img)

    def disc(r, fill, ox=0, oy=0):
        d.ellipse([cx + ox - r, cy + oy - r, cx + ox + r, cy + oy + r], fill=fill)

    disc(820, (38, 44, 58))                     # shadow rim
    disc(800, (150, 162, 180))                  # steel door
    disc(760, (118, 130, 150))
    for i in range(16):                         # bolts round the rim
        a = 2 * math.pi * (i + 0.5) / 16         # half a step off, so no bolt sits under a handle
        bx, by = cx + 690 * math.cos(a), cy + 690 * math.sin(a)
        d.ellipse([bx - 34, by - 34, bx + 34, by + 34], fill=(70, 78, 96))
        d.ellipse([bx - 22, by - 26, bx + 18, by + 14], fill=(196, 206, 222))
    for a in (90, 210, 330):                    # handle spokes
        t = math.radians(a)
        x1, y1 = cx + 520 * math.cos(t), cy + 520 * math.sin(t)
        x2, y2 = cx + 640 * math.cos(t), cy + 640 * math.sin(t)
        d.line([x1, y1, x2, y2], fill=(64, 72, 90), width=58)
        d.ellipse([x2 - 44, y2 - 44, x2 + 44, y2 + 44], fill=(216, 176, 92))
    disc(540, (84, 94, 114))                    # window ring
    disc(500, (12, 20, 44))                     # the sky behind the window
    for _ in range(90):
        a, r = rnd.uniform(0, 2 * math.pi), rnd.uniform(0, 480)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(210, 220, 255))
    disc(330, (252, 222, 150))                  # the moon
    for ox, oy, cr, shade in [(-120, -100, 60, 228), (100, 70, 80, 218), (-40, 160, 44, 230),
                               (160, -130, 38, 226), (-190, 60, 32, 232), (30, -10, 26, 222)]:
        disc(cr, (shade, int(shade * 0.8), int(shade * 0.52)), ox, oy)
    img = img.resize((n, n), Image.LANCZOS)
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


def ix_close_account(account, owner, dest=None, program=TOKEN):
    return Instruction(program, bytes([9]), [AccountMeta(account, False, True),
                                             AccountMeta(dest or owner, False, True),
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


def ix_init_pool(config, creator, mint, uri, payer=None):
    pool, bv, qv = pool_addresses(config, mint)
    return Instruction(DBC, init_pool_data(TOKEN_INFO["name"], TOKEN_INFO["symbol"], uri), [
        AccountMeta(config, False, False), AccountMeta(POOL_AUTHORITY, False, False),
        AccountMeta(creator, True, False), AccountMeta(mint, True, True),
        AccountMeta(WSOL, False, False), AccountMeta(pool, False, True),
        AccountMeta(bv, False, True), AccountMeta(qv, False, True),
        AccountMeta(payer or creator, True, True), AccountMeta(TOKEN, False, False),
        AccountMeta(TOKEN22, False, False), AccountMeta(SYSTEM, False, False),
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False)])


def ix_buy(config, mint, buyer, lamports_in, min_out, sysvar=True, output=None):
    """swap2 exact-in from the buyer's wSOL account. Tokens go to `output` (default: buyer's ATA)."""
    pool, bv, qv = pool_addresses(config, mint)
    return Instruction(DBC, swap2_data(lamports_in, min_out), [
        AccountMeta(POOL_AUTHORITY, False, False), AccountMeta(config, False, False),
        AccountMeta(pool, False, True),
        AccountMeta(ata(buyer, WSOL, TOKEN), False, True),                  # input: wSOL
        AccountMeta(output or ata(buyer, mint, TOKEN22), False, True),      # output: the new token
        AccountMeta(bv, False, True), AccountMeta(qv, False, True),
        AccountMeta(mint, False, False), AccountMeta(WSOL, False, False),
        AccountMeta(buyer, True, False),
        AccountMeta(TOKEN22, False, False), AccountMeta(TOKEN, False, False),
        AccountMeta(DBC, False, False),                                      # referral: none
        AccountMeta(EVENT_AUTHORITY, False, False), AccountMeta(DBC, False, False)]
        + ([AccountMeta(SYSVAR_IX, False, False)] if sysvar else []))      # enables min-fee first buy


# presale program: see presale-program/src/lib.rs for the account lists
@functools.lru_cache(maxsize=None)
def program_id():
    return keypair_file(PROGRAM_KEYPAIR).pubkey()


def presale_pda(mint):
    return Pubkey.find_program_address([b"presale", bytes(mint)], program_id())[0]


def receipt_pda(presale, user):
    return Pubkey.find_program_address([b"receipt", bytes(presale), bytes(user)], program_id())[0]


def presale_vault(mint):
    return ata(presale_pda(mint), mint, TOKEN22)


def ix_open_presale(authority, mint, pot, cap):
    return Instruction(program_id(), bytes([0]) + bytes(pot) + cap.to_bytes(8, "little"), [
        AccountMeta(authority, True, True), AccountMeta(presale_pda(mint), False, True),
        AccountMeta(mint, True, False), AccountMeta(SYSTEM, False, False)])


def ix_deposit(user, mint, lamports):
    presale = presale_pda(mint)
    return Instruction(program_id(), bytes([1]) + lamports.to_bytes(8, "little"), [
        AccountMeta(user, True, True), AccountMeta(presale, False, True),
        AccountMeta(receipt_pda(presale, user), False, True), AccountMeta(SYSTEM, False, False)])


def ix_release(authority, mint, pot_wsol):
    return Instruction(program_id(), bytes([2]), [
        AccountMeta(authority, True, False), AccountMeta(presale_pda(mint), False, True),
        AccountMeta(pot_wsol, False, True), AccountMeta(SYSVAR_IX, False, False)])


def ix_settle(mint, pot_wsol, min_tokens):
    return Instruction(program_id(), bytes([3]) + min_tokens.to_bytes(8, "little"), [
        AccountMeta(presale_pda(mint), False, True), AccountMeta(presale_vault(mint), False, False),
        AccountMeta(pot_wsol, False, False), AccountMeta(SYSVAR_IX, False, False)])


def ix_claim(user, mint):
    presale = presale_pda(mint)
    return Instruction(program_id(), bytes([4]), [
        AccountMeta(user, True, True), AccountMeta(presale, False, True),
        AccountMeta(receipt_pda(presale, user), False, True),
        AccountMeta(presale_vault(mint), False, True),
        AccountMeta(ata(user, mint, TOKEN22), False, True),
        AccountMeta(mint, False, False), AccountMeta(TOKEN22, False, False)])


def ix_withdraw(user, mint):
    presale = presale_pda(mint)
    return Instruction(program_id(), bytes([5]), [
        AccountMeta(user, True, True), AccountMeta(presale, False, True),
        AccountMeta(receipt_pda(presale, user), False, True)])


def build_tx(rpc, payer, ixs, signers, alts=(), cu_limit=None, cu_price=None):
    pre = []
    if cu_limit:
        pre.append(set_compute_unit_limit(cu_limit))
    if cu_price:
        pre.append(set_compute_unit_price(cu_price))
    bh, last_valid = rpc.blockhash()
    msg = MessageV0.try_compile(payer, pre + ixs, list(alts), bh)
    required = set(msg.account_keys[:msg.header.num_required_signatures])
    signers = list({str(s.pubkey()): s for s in signers}.values())
    return VersionedTransaction(msg, [s for s in signers if s.pubkey() in required]), last_valid


# ---- reading chain state -------------------------------------------------------------------
def read_presale(rpc, mint):
    acc = rpc.account(presale_pda(mint))
    if acc is None:
        return None
    d = base64.b64decode(acc["data"][0])
    cap, total, released, tokens, claimed = struct.unpack_from("<QQQQQ", d, 99)
    return dict(state=d[1], authority=Pubkey.from_bytes(d[3:35]), pot=Pubkey.from_bytes(d[35:67]),
                cap=cap, total_deposited=total, released=released, total_tokens=tokens,
                claimed_tokens=claimed, lamports=acc["lamports"])


def receipt_amount(rpc, mint, user):
    acc = rpc.account(receipt_pda(presale_pda(mint), user))
    return struct.unpack_from("<Q", base64.b64decode(acc["data"][0]), 35)[0] if acc else 0


def token_amount(rpc, account):
    acc = rpc.account(account)
    return struct.unpack_from("<Q", base64.b64decode(acc["data"][0]), 64)[0] if acc else 0


def presale_buy(total_lamports):
    """Raw tokens the pot's single buy returns at the 1% floor, as the first swap on a new pool."""
    p0, _, _ = curve_params()
    return curve_buy(p0, total_lamports, FEE_NUMERATOR)[1]


# ---- deploying the program -------------------------------------------------------------------
def build_program(log):
    if PROGRAM_SO.exists():
        return
    log("   building the presale program (cargo build-sbf)")
    subprocess.run(["cargo", "build-sbf", "--manifest-path", str(PROGRAM_DIR / "Cargo.toml")], check=True)


def program_deployed(rpc):
    acc = rpc.account(program_id())
    return bool(acc and acc.get("executable"))


def deploy_program(rpc, cu_price):
    """`solana program deploy`, paid by the operator (also the upgrade authority, so the
    program can be closed later and its rent returned). Returns the deploy signature.
    The upload chunks go straight to the validators (TPU) and are resent until they land; the RPC
    only fetches blockhashes and statuses. `--use-rpc` is the last resort: a rate-limited RPC
    drops chunks, and a dropped chunk waits out its blockhash before it is signed again."""
    cmd = ["solana", "program", "deploy", str(PROGRAM_SO),
           "--program-id", str(HERE / PROGRAM_KEYPAIR), "--keypair", str(HERE / OPERATOR_KEYPAIR),
           "--buffer", str(HERE / BUFFER_KEYPAIR), "--url", rpc.url,
           "--commitment", "confirmed", "--max-sign-attempts", "15"]
    if cu_price:
        cmd += ["--with-compute-unit-price", str(cu_price)]
    # the local fork's websocket fails the CLI's handshake, so the fork only uses --use-rpc
    tries = [["--use-rpc"]] * 3 if "127.0.0.1" in rpc.url else [[], [], ["--use-rpc"]]
    for attempt, extra in enumerate(tries, 1):     # each try resumes the saved buffer
        r = subprocess.run(cmd + extra, capture_output=True, text=True)
        out = r.stdout + r.stderr
        if r.returncode == 0 and program_deployed(rpc):
            return next((ln.split()[-1] for ln in out.splitlines() if ln.startswith("Signature")), None)
        why = [ln for ln in out.strip().splitlines() if ln.strip() and not ln.startswith("note:")]
        print(f"   deploy attempt {attempt} ({'through the RPC' if extra else 'straight to validators'}) "
              f"did not finish: {why[-1] if why else r.returncode}")
        time.sleep(5)
    raise RuntimeError("program deploy failed (re-run to resume from the saved buffer):\n" + out[-2000:])


def operator_need(rpc, deployed):
    """Lamports the operator needs for what is left to do."""
    need = 0
    if not deployed:        # the buffer's rent comes back at deploy and pays for the program data
        so = PROGRAM_SO.stat().st_size
        need += rpc.rent(45 + so) + rpc.rent(36) + (so // 1000 + 10) * 50_000
        buf = rpc.account(keypair_file(BUFFER_KEYPAIR).pubkey())
        if buf:             # a cut-off upload already paid for the buffer
            need -= buf["lamports"]
    # presale account, pool + mint + 2 pool vaults, the contract's vault, pot wSOL (returned), fees
    need += rpc.rent(PRESALE_LEN) + rpc.rent(424 + 8) + rpc.rent(500) + 2 * rpc.rent(170) \
        + rpc.rent(170) + rpc.rent(165) + 20_000_000
    return need


def wallet_need(rpc, contrib):
    """Deposit + receipt rent (back at claim) + the wallet's token account + fees."""
    return contrib + rpc.rent(RECEIPT_LEN) + rpc.rent(170) + 1_000_000


# ---- the run -------------------------------------------------------------------------
def launch_ixs(config, dev, mint, op, uri, total, bought):
    pot_wsol = ata(op, WSOL, TOKEN)
    return [ix_init_pool(config, dev, mint, uri, payer=op),
            ix_create_ata(op, op, WSOL, TOKEN),
            ix_release(op, mint, pot_wsol),
            ix_sync_native(pot_wsol),
            ix_create_ata(op, presale_pda(mint), mint, TOKEN22),
            ix_buy(config, mint, op, total, bought, output=presale_vault(mint)),
            ix_settle(mint, pot_wsol, bought),
            ix_close_account(pot_wsol, op)]


def run(rpc, wallets, contribs, config_kp, mint_kp, operator_kp, uri, cap, cu_price, log,
        prev=None, on_stage=None):
    """Executes steps 1-7 against `rpc`, skipping what is already done. Returns a result dict."""
    on_stage = on_stage or (lambda stage, res: None)
    dev = wallets[0]
    config, mint, op = config_kp.pubkey(), mint_kp.pubkey(), operator_kp.pubkey()
    res = dict(prev or {})
    res.update(rpc=rpc.url, mint=str(mint), config=str(config), program=str(program_id()),
               presale=str(presale_pda(mint)), vault=str(presale_vault(mint)), operator=str(op),
               wallets=[str(w.pubkey()) for w in wallets], contribs_lamports=contribs)

    ps = read_presale(rpc, mint)
    if ps is None and rpc.account(mint) is not None:
        raise RuntimeError(f"mint {mint} already exists but has no presale — it was launched some other way")
    launched = ps is not None and ps["state"] != OPEN

    # 1. top up the operator
    deployed = program_deployed(rpc)
    if not launched:
        need, have = operator_need(rpc, deployed), rpc.balance(op)
        if have < need:
            tx, lv = build_tx(rpc, dev.pubkey(), [transfer(TransferParams(
                from_pubkey=dev.pubkey(), to_pubkey=op, lamports=need - have))], [dev],
                cu_limit=5_000, cu_price=cu_price)
            res["fund_sig"], _ = rpc.send_and_confirm(tx, lv, f"1/7 dev -> operator {(need - have) / LAMPORTS:.4f} SOL")
        else:
            log("   1/7 operator already has enough SOL")

    # 2. deploy the presale program
    if not deployed:
        log(f"   2/7 deploying the presale program {program_id()} ({PROGRAM_SO.stat().st_size:,} bytes)…")
        res["deploy_sig"] = deploy_program(rpc, cu_price)
        log(f"   2/7 deployed ({res['deploy_sig']})")
    else:
        log("   2/7 presale program already deployed")

    # 3. config (anti-sniper fee lives here)
    if rpc.account(config) is None:
        tx, lv = build_tx(rpc, dev.pubkey(), [ix_create_config(config, dev.pubkey(), dev.pubkey(),
                                                               mooner_config())],
                          [dev, config_kp], cu_price=cu_price, cu_limit=200_000)
        res["config_sig"], _ = rpc.send_and_confirm(tx, lv, "3/7 create config")
    else:
        log("   3/7 config already exists — reusing it")

    # 4. open the presale (the mint key co-signs, so nobody else can open one for this CA)
    if ps is None:
        tx, lv = build_tx(rpc, op, [ix_open_presale(op, mint, op, cap)], [operator_kp, mint_kp],
                          cu_limit=40_000, cu_price=cu_price)
        res["open_sig"], _ = rpc.send_and_confirm(tx, lv, "4/7 open presale")
        ps = read_presale(rpc, mint)
    else:
        log(f"   4/7 presale already exists ({STATE_NAMES.get(ps['state'])})")

    # 5. deposits: each wallet, its own tx, straight into the contract
    if ps["state"] == OPEN:
        for i, (w, c) in enumerate(zip(wallets, contribs)):
            have = receipt_amount(rpc, mint, w.pubkey())
            if have >= c:
                continue
            tx, lv = build_tx(rpc, w.pubkey(), [ix_deposit(w.pubkey(), mint, c - have)], [w],
                              cu_limit=40_000, cu_price=cu_price)
            sig, _ = rpc.send_and_confirm(tx, lv, f"5/7 deposit {i} ({(c - have) / LAMPORTS} SOL)")
            res.setdefault("deposit_sigs", {})[str(w.pubkey())] = sig
        ps = read_presale(rpc, mint)
        on_stage("deposited", res)

    # 6. THE LAUNCH — one tx: create pool, release, one buy into the vault, settle
    if ps["state"] == OPEN:
        total = ps["total_deposited"]
        if total != sum(contribs):
            log(f"   note: the presale holds {total / LAMPORTS} SOL, not {sum(contribs) / LAMPORTS}"
                " (someone else deposited too)")
        bought = presale_buy(total)
        ixs = launch_ixs(config, dev.pubkey(), mint, op, uri, total, bought)
        tx, lv = build_tx(rpc, op, ixs, [operator_kp, dev, mint_kp], cu_limit=400_000, cu_price=cu_price)
        res["launch_tx_bytes"] = len(bytes(tx))
        log(f"   launch tx: {len(ixs)} instructions, 3 signers, {res['launch_tx_bytes']} / {TX_LIMIT} bytes")
        if res["launch_tx_bytes"] > TX_LIMIT:
            raise RuntimeError("launch tx too big")
        res["launch_sig"], res["launch_slot"] = rpc.send_and_confirm(tx, lv, "6/7 LAUNCH")
        res["tokens_bought_expected_raw"] = bought
        on_stage("launched", res)

    # 7. claims: each wallet, its own tx, from the contract's vault
    for i, w in enumerate(wallets):
        if receipt_amount(rpc, mint, w.pubkey()) == 0:
            continue
        tx, lv = build_tx(rpc, w.pubkey(), [ix_create_ata(w.pubkey(), w.pubkey(), mint, TOKEN22),
                                            ix_claim(w.pubkey(), mint)], [w],
                          cu_limit=150_000, cu_price=cu_price)
        sig, _ = rpc.send_and_confirm(tx, lv, f"7/7 claim {i}")
        res.setdefault("claim_sigs", {})[str(w.pubkey())] = sig
    on_stage("claimed", res)

    # verify from the chain
    t = rpc.call("getTransaction", [res["launch_sig"], {"encoding": "json", "commitment": "confirmed",
                                                         "maxSupportedTransactionVersion": 0}])
    logs = t["meta"]["logMessages"]
    res["launch_cu"] = t["meta"].get("computeUnitsConsumed")
    res["launch_fee_lamports"] = t["meta"]["fee"]
    res["swaps_in_launch_tx"] = sum(1 for ln in logs if ln.endswith("Instruction: Swap2"))
    res["init_in_launch_tx"] = any("InitializeVirtualPoolWithToken2022" in ln for ln in logs)
    ps = read_presale(rpc, mint)
    res.update(presale_state=ps["state"], total_deposited=ps["total_deposited"],
               total_tokens=ps["total_tokens"], claimed_tokens=ps["claimed_tokens"])
    res["fee_numerator_paid"] = implied_fee(curve_params()[0], ps["total_deposited"], ps["total_tokens"])
    res["tokens_expected_raw"] = [ps["total_tokens"] * c // ps["total_deposited"] for c in contribs]
    res["tokens_received_raw"] = [token_amount(rpc, ata(w.pubkey(), mint, TOKEN22)) for w in wallets]
    res["vault_left_raw"] = token_amount(rpc, presale_vault(mint))
    return res


# ---- rehearsal-only: make sure the contract says no ------------------------------------------
def expect_reject(rpc, payer, ixs, signers, label, res, log):
    tx, _ = build_tx(rpc, payer.pubkey(), ixs, signers, cu_limit=400_000)
    err = rpc.simulate(tx)["err"]
    res.setdefault("checks", []).append([label, err is not None])
    log(f"   check  {label}: {'rejected — good' if err is not None else 'ACCEPTED — BAD'}")


def rehearsal_checks(fork, wallets, contribs, config_kp, mint_kp, operator_kp, cap, log):
    """Stage hooks for run(): try things the contract must refuse, plus a withdraw and a sniper."""
    rpc, dev, op, mint = fork.rpc, wallets[0], operator_kp, mint_kp.pubkey()
    pot_wsol = ata(op.pubkey(), WSOL, TOKEN)
    stranger = Keypair()
    fork.fund(stranger.pubkey(), 2)

    def on_stage(stage, res):
        if stage == "deposited":
            expect_reject(rpc, dev, [ix_deposit(dev.pubkey(), mint, cap - contribs[0] + 1)], [dev],
                          "deposit over the per-wallet cap", res, log)
            expect_reject(rpc, op, [ix_create_ata(op.pubkey(), op.pubkey(), WSOL, TOKEN),
                                    ix_release(op.pubkey(), mint, pot_wsol)], [op],
                          "operator takes the SOL without a settle", res, log)
            expect_reject(rpc, op, [ix_create_ata(op.pubkey(), op.pubkey(), WSOL, TOKEN),
                                    ix_release(op.pubkey(), mint, pot_wsol), ix_sync_native(pot_wsol),
                                    ix_create_ata(op.pubkey(), presale_pda(mint), mint, TOKEN22),
                                    ix_settle(mint, pot_wsol, 0)], [op],
                          "operator releases + settles with no buy", res, log)
            before = read_presale(rpc, mint)["total_deposited"]
            bal0 = rpc.balance(stranger.pubkey())
            for label, ix in (("deposit", ix_deposit(stranger.pubkey(), mint, LAMPORTS // 20)),
                              ("withdraw", ix_withdraw(stranger.pubkey(), mint))):
                tx, lv = build_tx(rpc, stranger.pubkey(), [ix], [stranger], cu_limit=40_000)
                rpc.send_and_confirm(tx, lv, f"   stranger {label}")
            after = read_presale(rpc, mint)["total_deposited"]
            lost = bal0 - rpc.balance(stranger.pubkey())
            ok = after == before and lost <= 20_000
            res.setdefault("checks", []).append(["withdraw before launch returns everything", ok])
            log(f"   check  withdraw before launch returns everything: "
                f"{'yes' if ok else 'NO'} (lost {lost} lamports to tx fees)")
        elif stage == "launched":
            s_sig, s_slot, s_out = snipe(rpc, mint, config_kp.pubkey(), sum(contribs), log)
            t0 = rpc.call("getBlockTime", [res["launch_slot"]])
            t1 = rpc.call("getBlockTime", [s_slot])
            res["sniper"] = {"sig": s_sig, "slot": s_slot, "lamports": sum(contribs), "tokens_raw": s_out,
                             "fee_numerator": implied_fee(
                                 curve_buy(curve_params()[0], sum(contribs), FEE_NUMERATOR)[0],
                                 sum(contribs), s_out),
                             "seconds_after": (t1 - t0) if (t0 and t1) else None}
            expect_reject(rpc, dev, [ix_deposit(dev.pubkey(), mint, LAMPORTS // 100)], [dev],
                          "deposit after launch", res, log)
        elif stage == "claimed":
            expect_reject(rpc, dev, [ix_claim(dev.pubkey(), mint)], [dev], "claim twice", res, log)
            expect_reject(rpc, stranger, [ix_create_ata(stranger.pubkey(), stranger.pubkey(), mint, TOKEN22),
                                          ix_claim(stranger.pubkey(), mint)], [stranger],
                          "claim without a deposit", res, log)
    return on_stage


def snipe(rpc, mint, config, lamports, log):
    """Rehearsal only: a fresh wallet buys right after the launch, like a bot.
    Returns (signature, slot, raw tokens out)."""
    bot = Keypair()
    sig = rpc.call("requestAirdrop", [str(bot.pubkey()), lamports + LAMPORTS])
    for _ in range(60):
        st = rpc.call("getSignatureStatuses", [[sig]])["value"][0]
        if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
            break
        time.sleep(0.3)
    b_wsol = ata(bot.pubkey(), WSOL, TOKEN)
    ixs = [ix_create_ata(bot.pubkey(), bot.pubkey(), WSOL, TOKEN),
           transfer(TransferParams(from_pubkey=bot.pubkey(), to_pubkey=b_wsol, lamports=lamports)),
           ix_sync_native(b_wsol),
           ix_create_ata(bot.pubkey(), bot.pubkey(), mint, TOKEN22),
           ix_buy(config, mint, bot.pubkey(), lamports, 0, sysvar=False)]
    tx, lv = build_tx(rpc, bot.pubkey(), ixs, [bot], cu_limit=200_000)
    sig, slot = rpc.send_and_confirm(tx, lv, "   sniper buy")
    out = int(rpc.call("getTokenAccountBalance", [str(ata(bot.pubkey(), mint, TOKEN22)),
                                                  {"commitment": "confirmed"}])["value"]["amount"])
    return sig, slot, out


# ---- local mainnet fork --------------------------------------------------------------------
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class LocalFork:
    """solana-test-validator with the live DBC program and mainnet's feature set cloned."""

    def __init__(self, source_rpc):
        self.dir = tempfile.mkdtemp(prefix="mooner-fork-")
        self.port = free_port()
        while self.port + 40 > 65535:          # the validator needs port+10..port+40 free too
            self.port = free_port()
        cmd = ["solana-test-validator", "--reset", "--quiet", "--ledger", self.dir,
               "--rpc-port", str(self.port), "--faucet-port", str(free_port()),
               "--gossip-port", str(free_port()), "--dynamic-port-range",
               f"{self.port + 10}-{self.port + 40}",
               "--url", source_rpc, "--clone-feature-set", "--clone-upgradeable-program", str(DBC)]
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
    ap.add_argument("--contrib", default="0.1",
                    help="SOL each wallet deposits: one value for all, or one per wallet (default 0.1)")
    ap.add_argument("--cap", type=float, default=CAP_SOL, help=f"max SOL per wallet (default {CAP_SOL})")
    ap.add_argument("--priority", type=int, default=200_000, help="priority fee, micro-lamports per CU")
    ap.add_argument("--wallets", help="comma-separated .env names, first = dev "
                                      "(default: WALLETS in launch-test/.env)")
    ap.add_argument("--throwaway", type=int, nargs="?", const=3, metavar="N",
                    help="rehearse with N generated wallets (default 3) instead of the .env")
    args = ap.parse_args()

    state = load_state()
    mint_kp = keypair_file("mint-keypair.json")
    config_kp = keypair_file("config-keypair.json")
    operator_kp = keypair_file(OPERATOR_KEYPAIR)
    keypair_file(BUFFER_KEYPAIR)
    mint = mint_kp.pubkey()
    print(f"Token     {TOKEN_INFO['name']} (${TOKEN_INFO['symbol']})")
    print(f"CA (mint) {mint}")
    print(f"Config    {config_kp.pubkey()}  (Mooner partner config on DBC, anti-sniper fee)")
    print(f"Program   {program_id()}  (Mooner presale program)")
    print(f"Presale   {presale_pda(mint)}  (the contract account holding the SOL)")
    print(f"Vault     {presale_vault(mint)}  (the contract's token account)")
    print(f"Operator  {operator_kp.pubkey()}  (Mooner's key: deploys, opens, makes the one buy)")

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

    if args.throwaway:
        wallets = [(f"THROWAWAY_{i}", Keypair()) for i in range(args.throwaway)]
    else:
        pick = args.wallets
        if pick is None and (HERE / ".env").exists():
            pick = dict(read_env(HERE / ".env")).get("WALLETS")
        if pick:
            names = [n.strip() for n in pick.split(",") if n.strip()]
            by_name = dict(wallets)
            missing = [n for n in names if n not in by_name]
            if missing:
                sys.exit(f"--wallets/WALLETS: unknown {missing}; available: {', '.join(n for n, _ in wallets)}")
            wallets = [(n, by_name[n]) for n in names]
    if not wallets:
        sys.exit(f"No wallets found in {args.env or HERE / '.env'}. "
                 "Use --env /path/to/.env or WALLETS_ENV=... in launch-test/.env")
    names, kps = [n for n, _ in wallets], [k for _, k in wallets]
    try:
        vals = [int(round(float(x) * LAMPORTS)) for x in args.contrib.split(",")]
    except ValueError:
        sys.exit("--contrib takes SOL amounts, e.g. 0.1 or 0.1,0.2,0.05")
    contribs = vals * len(kps) if len(vals) == 1 else vals
    cap = int(round(args.cap * LAMPORTS))
    if len(contribs) != len(kps) or min(contribs) <= 0 or max(contribs) > cap:
        sys.exit(f"--contrib needs 1 or {len(kps)} amounts, each > 0 and <= the {args.cap} SOL cap")
    total = sum(contribs)
    bought = presale_buy(total)
    print(f"\nPresale   {len(kps)} wallets deposit {total / LAMPORTS} SOL -> one buy of "
          f"{bought / 10**DECIMALS:,.2f} tokens, everyone at {total / LAMPORTS / (bought / 10**DECIMALS):.4e} SOL/token")
    for i, (nm, w, c) in enumerate(zip(names, kps, contribs)):
        if i < 10 or i == len(kps) - 1:
            role = "Dev" if i == 0 else f"Wallet {i}"
            print(f"{role:9} {w.pubkey()}  [{nm}]  deposits {c / LAMPORTS} SOL -> claims "
                  f"{bought * c // total / 10**DECIMALS:,.2f}")
        elif i == 10:
            print(f"          … {len(kps) - 11} more")

    build_program(print)
    mainnet = Rpc(args.rpc or env_rpc or MAINNET_RPC)
    deployed = program_deployed(mainnet)
    op_short = max(0, operator_need(mainnet, deployed) - mainnet.balance(operator_kp.pubkey()))
    needs = [wallet_need(mainnet, c) for c in contribs]
    needs[0] += op_short                                   # the dev tops up the operator

    if args.confirm:
        if args.throwaway:
            sys.exit("--throwaway is rehearsal-only")
        prev = state.get("mainnet") if state.get("mainnet", {}).get("mint") == str(mint) else None
        if not prev:
            short = [(w, n) for w, n in zip(kps, needs) if mainnet.balance(w.pubkey()) < n]
            for w, n in short:
                print(f"!! {w.pubkey()} needs ~{n / LAMPORTS:.4f} SOL")
            if short:
                sys.exit("Not enough SOL — nothing was sent.")
        print(f"\nMAINNET via {mainnet.url}")
        try:
            res = run(mainnet, kps, contribs, config_kp, mint_kp, operator_kp, uri, cap, args.priority,
                      print, prev=prev, on_stage=lambda stage, r: (state.__setitem__("mainnet", r), save_state(state)))
        except Exception:
            print("\n!! stopped. Re-run the same command: it picks up where it stopped.")
            raise
        state["mainnet"] = res
        save_state(state)
        report(res, mainnet=True)
        return

    # dry run ---------------------------------------------------------------------------
    print(f"\nDRY RUN — mainnet checks via {mainnet.url}")
    prog = mainnet.account(DBC)
    print(f"   DBC program on mainnet: {'yes' if prog and prog['executable'] else 'NO'}")
    print(f"   mint unused on mainnet: {'yes' if mainnet.account(mint) is None else 'NO — already exists'}")
    print(f"   config on mainnet: {'exists (will reuse)' if mainnet.account(config_kp.pubkey()) else 'not yet (step 3 creates it)'}")
    so = PROGRAM_SO.stat().st_size
    print(f"   presale program on mainnet: {'deployed' if deployed else 'not yet'}"
          + ("" if deployed else f" — step 2 deploys it ({so:,} bytes, {mainnet.rent(45 + so) / LAMPORTS:.4f} SOL "
                                 "rent, returned when the program is closed)"))
    print(f"   operator {str(operator_kp.pubkey())[:8]}… has {mainnet.balance(operator_kp.pubkey()) / LAMPORTS:.4f} SOL,"
          f" dev tops it up by ~{op_short / LAMPORTS:.4f}")
    for i, (w, n) in enumerate(zip(kps, needs)):
        if i >= 10 and i != len(kps) - 1:
            continue
        bal = mainnet.balance(w.pubkey())
        print(f"   {str(w.pubkey())[:8]}… balance {bal / LAMPORTS:.4f} SOL, needs ~{n / LAMPORTS:.4f}  "
              f"{'ok' if bal >= n else 'SHORT'}")

    if not shutil.which("solana-test-validator"):
        print("\n(solana-test-validator not installed — skipping the local rehearsal)")
        return
    print("\nREHEARSAL on a local mainnet fork (DBC + feature set cloned from mainnet, SOL airdropped locally)")
    fork = LocalFork(mainnet.url if "127.0.0.1" not in mainnet.url else MAINNET_RPC)
    try:
        for w, c in zip(kps, contribs):
            fork.fund(w.pubkey(), c / LAMPORTS + 0.5)
        fork.fund(kps[0].pubkey(), 5)                      # the dev also tops up the operator
        hooks = rehearsal_checks(fork, kps, contribs, config_kp, mint_kp, operator_kp, cap, print)
        res = run(fork.rpc, kps, contribs, config_kp, mint_kp, operator_kp, uri, cap, args.priority,
                  print, on_stage=hooks)
    finally:
        fork.close()
    state["rehearsal"] = res
    save_state(state)
    report(res, mainnet=False)


def report(res, mainnet):
    got, exp, contribs = res["tokens_received_raw"], res["tokens_expected_raw"], res["contribs_lamports"]
    checks = res.get("checks", [])
    ok = (res["init_in_launch_tx"] and res["swaps_in_launch_tx"] == 1 and got == exp
          and res["presale_state"] == SETTLED and all(c[1] for c in checks))
    print(f"\n{'MAINNET' if mainnet else 'REHEARSAL'} RESULT: {'PASS' if ok else 'CHECK'}")
    print(f"   launch tx   {res['launch_sig']}  (slot {res['launch_slot']})")
    print(f"   in that tx  pool created: {res['init_in_launch_tx']}, buys: {res['swaps_in_launch_tx']} (the contract's)")
    if res.get("launch_tx_bytes"):
        print(f"   size / CU   {res['launch_tx_bytes']} bytes, {res['launch_cu']} CU, fee {res['launch_fee_lamports']} lamports")
    print(f"   contract    {len(contribs)} wallets deposited {res['total_deposited'] / LAMPORTS} SOL, bought "
          f"{res['total_tokens'] / 10**DECIMALS:,.6f} tokens paying a {res['fee_numerator_paid'] / 1e7:.2f}% fee; "
          f"{res['vault_left_raw']} raw units of rounding dust left in the vault")
    prices = [(c / LAMPORTS) / (g / 10**DECIMALS) if g else float("inf") for c, g in zip(contribs, got)]
    for i, (g, x, c, px) in enumerate(zip(got, exp, contribs, prices)):
        if i < 10 or i == len(got) - 1:
            print(f"   wallet {i:<4} deposited {c / LAMPORTS} SOL, got {g / 10**DECIMALS:,.6f} tokens "
                  f"(expected {x / 10**DECIMALS:,.6f}) = {px:.9e} SOL/token")
        elif i == 10:
            print(f"   … {len(got) - 11} more")
    if all(math.isfinite(p) for p in prices):
        print(f"   same price  all {len(prices)} wallets within {(max(prices) / min(prices) - 1) * 100:.2e}% "
              "(floor rounding of raw units)")
    for label, passed in checks:
        print(f"   check       {label}: {'ok' if passed else 'FAILED'}")
    sn = res.get("sniper")
    if sn:
        spx = (sn["lamports"] / LAMPORTS) / (sn["tokens_raw"] / 10**DECIMALS) if sn["tokens_raw"] else float("inf")
        print(f"   sniper      bought {sn['lamports'] / LAMPORTS} SOL right after "
              f"(+{sn['seconds_after']}s, slot {sn['slot']}): got {sn['tokens_raw'] / 10**DECIMALS:,.2f} tokens"
              f" = {spx:.3e} SOL/token, paid a {sn['fee_numerator'] / 1e7:.2f}% fee")
    if mainnet:
        print(f"   https://solscan.io/tx/{res['launch_sig']}")
        print(f"   https://solscan.io/token/{res['mint']}")


if __name__ == "__main__":
    main()
