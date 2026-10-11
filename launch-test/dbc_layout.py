"""Borsh layouts for Meteora Dynamic Bonding Curve (program dbcij3...).

Written from the program source (programs/dynamic-bonding-curve, v0.2.1):
ConfigParameters, InitializePoolParameters, SwapParameters2.
"""
import hashlib
import struct


def disc(name: str) -> bytes:
    """Anchor instruction discriminator: sha256("global:<name>")[:8]."""
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


class W:
    def __init__(self):
        self.b = bytearray()

    def u8(self, v): self.b += struct.pack("<B", v); return self
    def u16(self, v): self.b += struct.pack("<H", v); return self
    def u32(self, v): self.b += struct.pack("<I", v); return self
    def u64(self, v): self.b += struct.pack("<Q", v); return self
    def u128(self, v): self.b += int(v).to_bytes(16, "little"); return self
    def bool(self, v): return self.u8(1 if v else 0)
    def str(self, s):
        e = s.encode()
        self.u32(len(e)); self.b += e; return self
    def raw(self, bs): self.b += bs; return self


class R:
    def __init__(self, b, o=0):
        self.b, self.o = b, o

    def _f(self, fmt):
        v = struct.unpack_from(fmt, self.b, self.o); self.o += struct.calcsize(fmt); return v[0]
    def u8(self): return self._f("<B")
    def u16(self): return self._f("<H")
    def u32(self): return self._f("<I")
    def u64(self): return self._f("<Q")
    def u128(self):
        v = int.from_bytes(self.b[self.o:self.o + 16], "little"); self.o += 16; return v
    def bool(self): return self.u8() == 1
    def str(self):
        n = self.u32(); s = self.b[self.o:self.o + n].decode(); self.o += n; return s


# ---- ConfigParameters -------------------------------------------------------
# Field order is the struct order in process_create_config.rs. Nested structs are
# plain dicts with the Rust field names.

def enc_config(w: W, c: dict):
    bf = c["pool_fees"]["base_fee"]
    w.u64(bf["cliff_fee_numerator"]).u16(bf["first_factor"]).u64(bf["second_factor"]) \
     .u64(bf["third_factor"]).u8(bf["base_fee_mode"])
    df = c["pool_fees"]["dynamic_fee"]
    if df is None:
        w.u8(0)
    else:
        w.u8(1).u16(df["bin_step"]).u128(df["bin_step_u128"]).u16(df["filter_period"]) \
         .u16(df["decay_period"]).u16(df["reduction_factor"]) \
         .u32(df["max_volatility_accumulator"]).u32(df["variable_fee_control"])
    for k in ("collect_fee_mode", "migration_option", "activation_type", "token_type",
              "token_decimal", "partner_liquidity_percentage",
              "partner_permanent_locked_liquidity_percentage", "creator_liquidity_percentage",
              "creator_permanent_locked_liquidity_percentage"):
        w.u8(c[k])
    w.u64(c["migration_quote_threshold"]).u128(c["sqrt_start_price"])
    lv = c["locked_vesting"]
    for k in ("amount_per_period", "cliff_duration_from_migration_time", "frequency",
              "number_of_period", "cliff_unlock_amount"):
        w.u64(lv[k])
    w.u8(c["migration_fee_option"])
    ts = c["token_supply"]
    if ts is None:
        w.u8(0)
    else:
        w.u8(1).u64(ts["pre_migration_token_supply"]).u64(ts["post_migration_token_supply"])
    w.u8(c["creator_trading_fee_percentage"]).u8(c["token_update_authority"])
    w.u8(c["migration_fee"]["fee_percentage"]).u8(c["migration_fee"]["creator_fee_percentage"])
    mp = c["migrated_pool_fee"]
    w.u8(mp["collect_fee_mode"]).u8(mp["dynamic_fee"]).u16(mp["pool_fee_bps"])
    w.u64(c["pool_creation_fee"])
    for k in ("partner_liquidity_vesting_info", "creator_liquidity_vesting_info"):
        v = c[k]
        w.u8(v["vesting_percentage"]).u16(v["bps_per_period"]).u16(v["number_of_periods"]) \
         .u32(v["cliff_duration_from_migration_time"]).u32(v["frequency"])
    w.u8(c["migrated_pool_base_fee_mode"])
    m = c["migrated_pool_market_cap_fee_scheduler_params"]
    w.u16(m["number_of_period"]).u16(m["sqrt_price_step_bps"]) \
     .u32(m["scheduler_expiration_duration"]).u64(m["reduction_factor"])
    w.bool(c["enable_first_swap_with_min_fee"]).u16(c["compounding_fee_bps"])
    w.raw(bytes(c.get("padding", [0, 0])))
    w.u32(len(c["curve"]))
    for p in c["curve"]:
        w.u128(p["sqrt_price"]).u128(p["liquidity"])
    return w


def dec_config(r: R) -> dict:
    c = {}
    bf = dict(cliff_fee_numerator=r.u64(), first_factor=r.u16(), second_factor=r.u64(),
              third_factor=r.u64(), base_fee_mode=r.u8())
    df = None
    if r.u8():
        df = dict(bin_step=r.u16(), bin_step_u128=r.u128(), filter_period=r.u16(),
                  decay_period=r.u16(), reduction_factor=r.u16(),
                  max_volatility_accumulator=r.u32(), variable_fee_control=r.u32())
    c["pool_fees"] = dict(base_fee=bf, dynamic_fee=df)
    for k in ("collect_fee_mode", "migration_option", "activation_type", "token_type",
              "token_decimal", "partner_liquidity_percentage",
              "partner_permanent_locked_liquidity_percentage", "creator_liquidity_percentage",
              "creator_permanent_locked_liquidity_percentage"):
        c[k] = r.u8()
    c["migration_quote_threshold"] = r.u64()
    c["sqrt_start_price"] = r.u128()
    c["locked_vesting"] = {k: r.u64() for k in (
        "amount_per_period", "cliff_duration_from_migration_time", "frequency",
        "number_of_period", "cliff_unlock_amount")}
    c["migration_fee_option"] = r.u8()
    c["token_supply"] = dict(pre_migration_token_supply=r.u64(),
                             post_migration_token_supply=r.u64()) if r.u8() else None
    c["creator_trading_fee_percentage"] = r.u8()
    c["token_update_authority"] = r.u8()
    c["migration_fee"] = dict(fee_percentage=r.u8(), creator_fee_percentage=r.u8())
    c["migrated_pool_fee"] = dict(collect_fee_mode=r.u8(), dynamic_fee=r.u8(), pool_fee_bps=r.u16())
    c["pool_creation_fee"] = r.u64()
    for k in ("partner_liquidity_vesting_info", "creator_liquidity_vesting_info"):
        c[k] = dict(vesting_percentage=r.u8(), bps_per_period=r.u16(), number_of_periods=r.u16(),
                    cliff_duration_from_migration_time=r.u32(), frequency=r.u32())
    c["migrated_pool_base_fee_mode"] = r.u8()
    c["migrated_pool_market_cap_fee_scheduler_params"] = dict(
        number_of_period=r.u16(), sqrt_price_step_bps=r.u16(),
        scheduler_expiration_duration=r.u32(), reduction_factor=r.u64())
    c["enable_first_swap_with_min_fee"] = r.bool()
    c["compounding_fee_bps"] = r.u16()
    c["padding"] = [r.u8(), r.u8()]
    n = r.u32()
    c["curve"] = [dict(sqrt_price=r.u128(), liquidity=r.u128()) for _ in range(n)]
    return c


def create_config_data(c: dict) -> bytes:
    return bytes(enc_config(W().raw(disc("create_config")), c).b)


def init_pool_data(name: str, symbol: str, uri: str) -> bytes:
    return bytes(W().raw(disc("initialize_virtual_pool_with_token2022")).str(name).str(symbol).str(uri).b)


SWAP_MODE_EXACT_IN = 0


def swap2_data(amount_in: int, min_out: int, mode: int = SWAP_MODE_EXACT_IN) -> bytes:
    return bytes(W().raw(disc("swap2")).u64(amount_in).u64(min_out).u8(mode).b)
