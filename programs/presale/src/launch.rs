//! 6 release, 7 settle: the launch tx (spec "Launch tx"). Ported from the mainnet-proven
//! launch-test/presale-program, plus the config, fee-destination, cost-cap and
//! foreign-program checks.
//!
//! The pot's buy must be a top-level ix (not a CPI from here): DBC gives the 1% floor only
//! to the first swap in the tx that creates the pool, read from the instructions sysvar.

use crate::consts::*;
use crate::error::Error;
use crate::state::*;
use crate::util::*;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};

pub fn pool_addresses(dbc_config: &Pubkey, mint: &Pubkey) -> (Pubkey, Pubkey, Pubkey) {
    let (hi, lo) = if mint.as_ref() > WSOL.as_ref() { (mint, &WSOL) } else { (&WSOL, mint) };
    let pool = Pubkey::find_program_address(&[b"pool", dbc_config.as_ref(), hi.as_ref(), lo.as_ref()], &DBC).0;
    let base = Pubkey::find_program_address(&[b"token_vault", mint.as_ref(), pool.as_ref()], &DBC).0;
    let quote = Pubkey::find_program_address(&[b"token_vault", WSOL.as_ref(), pool.as_ref()], &DBC).0;
    (pool, base, quote)
}

fn disc(data: &[u8]) -> Option<[u8; 8]> {
    data.get(..8).map(|d| d.try_into().unwrap())
}

/// [bot s w, config, presale w, rec(presale), pot, pot_wsol w, mint, pool, base_vault,
///  quote_vault, presale_vault, ix_sysvar]
/// Moves `released` to the pot's wSOL and the capped launch cost to the bot.
pub fn release(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [bot, config, presale, presale_record, pot, pot_wsol, mint, pool, base_vault, quote_vault, presale_vault, sysvar, ..] =
        accounts
    else {
        return Err(Error::BadData.into());
    };
    let c = Config::load(config, program_id)?;
    require_signer(bot)?;
    if *bot.key != c.bot {
        return Err(Error::NotAuthorized.into());
    }
    let mut p = Presale::load(presale, program_id)?;
    require_home(program_id, presale, presale_record)?;
    if p.state != FULL {
        return Err(Error::BadState.into());
    }
    if p.seats_settled != p.seats_committed {
        return Err(Error::NotAllSettled.into());
    }
    require_key(mint, &p.mint)?;
    let (pool_k, base_k, quote_k) = pool_addresses(&c.dbc_config, &p.mint);
    require_key(pool, &pool_k)?;
    require_key(base_vault, &base_k)?;
    require_key(quote_vault, &quote_k)?;
    require_key(presale_vault, &ata(presale.key, &p.mint, &TOKEN22))?;
    require_key(pot_wsol, &ata(pot.key, &WSOL, &TOKEN))?;
    token_account(presale_vault, &TOKEN22)?;
    token_account(pot_wsol, &TOKEN)?;

    // the pool was created earlier in this tx, on our config, with these accounts,
    // and a settle for this presale comes later
    let tx = TxIxs::new(sysvar)?;
    let (mut created, mut settled_later) = (false, false);
    for i in 0..tx.count {
        let ix = tx.get(i)?;
        if i < tx.current && ix.program_id == DBC && disc(&ix.data).is_some_and(|d| INIT_POOL_DISCS.contains(&d)) {
            let a = |n: usize| ix.accounts.get(n).map(|m| m.pubkey);
            if a(3) == Some(p.mint) {
                if a(0) != Some(c.dbc_config) {
                    return Err(Error::WrongDbcConfig.into());
                }
                created = a(5) == Some(pool_k) && a(6) == Some(base_k) && a(7) == Some(quote_k);
            }
        }
        if i > tx.current
            && ix.program_id == *program_id
            && ix.data.first() == Some(&IX_SETTLE)
            && ix.accounts.first().map(|m| m.pubkey) == Some(*presale.key)
        {
            settled_later = true;
        }
    }
    if !created || !settled_later {
        msg!("release needs init_pool before it and settle after it, in the same tx");
        return Err(Error::BadLaunchTx.into());
    }

    let cost = [mint, pool, base_vault, quote_vault, presale_vault]
        .iter()
        .try_fold(LAUNCH_TX_FEE, |acc, a| Ok::<u64, solana_program::program_error::ProgramError>(acc + rent(a.data_len())?))?;
    if cost > LAUNCH_COST_CAP {
        return Err(Error::CostCap.into());
    }
    let reserve = p
        .seats_committed
        .checked_mul(rent(presale_vault.data_len())? + TX_FEE)
        .ok_or(Error::Overflow)?;
    // from the ledger, not the balance: lamports sent to the Presale can't change the
    // amount the bot planned (they stay in it and go to the creator at close)
    let released = p
        .settled_sum
        .checked_sub(p.fees_paid)
        .and_then(|x| x.checked_sub(cost))
        .and_then(|x| x.checked_sub(reserve))
        .filter(|x| *x > 0)
        .ok_or(Error::NothingReleased)?;
    let keep = [rent(PRESALE_LEN)?, reserve, cost, released].iter().try_fold(0u64, |a, x| a.checked_add(*x));
    if keep.is_none_or(|k| presale.lamports() < k) {
        return Err(Error::NothingReleased.into());
    }
    move_lamports(presale, pot_wsol, released)?;
    move_lamports(presale, bot, cost)?;
    p.released = released;
    p.pot = *pot.key;
    p.state = LAUNCHING;
    p.store(presale)
}

/// [presale w, config, presale_vault, pot_wsol, ix_sysvar, pool]  data: min_tokens 8
/// The whole tx must be: init_pool < release < the one pot swap < settle, plus a
/// transfer_pool_creator to fee_dest, and no program outside the allowlist. The buy must
/// have paid DBC's 1% floor fee, read back from the pool.
pub fn settle(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [presale, config, vault, pot_wsol, sysvar, pool_acc, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let min_tokens = u64_at(args::<8>(rest)?, 0);
    let c = Config::load(config, program_id)?;
    let mut p = Presale::load(presale, program_id)?;
    if p.state != LAUNCHING {
        return Err(Error::BadState.into());
    }
    require_key(vault, &ata(presale.key, &p.mint, &TOKEN22))?;
    require_key(pot_wsol, &ata(&p.pot, &WSOL, &TOKEN))?;
    let (v_mint, v_owner, tokens) = token_account(vault, &TOKEN22)?;
    let (_, _, wsol_left) = token_account(pot_wsol, &TOKEN)?;
    if v_mint != p.mint || v_owner != *presale.key {
        return Err(Error::BadAccount.into());
    }
    if wsol_left != 0 {
        return Err(Error::PotNotEmpty.into());
    }

    let tx = TxIxs::new(sysvar)?;
    let (mut created_at, mut released_at, mut bought_at) = (None, None, None);
    let (mut swaps, mut pool, mut creator) = (0, None, None);
    let mut tpc = Vec::new(); // (pool, creator, new_creator) of every transfer_pool_creator
    for i in 0..tx.count {
        let ix = tx.get(i)?;
        let a = |n: usize| ix.accounts.get(n).map(|m| m.pubkey);
        if ix.program_id == *program_id {
            if i < tx.current && ix.data.first() == Some(&IX_RELEASE) && a(2) == Some(*presale.key) {
                released_at = Some(i);
            }
            continue;
        }
        if [COMPUTE_BUDGET, SYSTEM, TOKEN, TOKEN22, ATA_PROGRAM].contains(&ix.program_id) {
            continue;
        }
        if ix.program_id != DBC {
            msg!("launch tx calls a program outside the allowlist");
            return Err(Error::BadLaunchTx.into());
        }
        let d = disc(&ix.data).ok_or(Error::BadLaunchTx)?;
        if INIT_POOL_DISCS.contains(&d) {
            if a(3) == Some(p.mint) {
                if a(0) != Some(c.dbc_config) {
                    return Err(Error::WrongDbcConfig.into());
                }
                created_at = Some(i);
                pool = a(5);
                creator = a(2);
            }
        } else if SWAP_DISCS.contains(&d) {
            swaps += 1;
            if d == SWAP2_DISC
                && ix.data.len() >= 25
                && u64_at(&ix.data, 8) == p.released
                && ix.data[24] == 0 // exact in
                && pool.is_some()
                && a(2) == pool
                && a(3) == Some(*pot_wsol.key)
                && a(4) == Some(*vault.key)
                && a(7) == Some(p.mint)
                && a(9) == Some(p.pot)
                && a(12) == Some(DBC) // no referral
                && a(SWAP2_SYSVAR_AT) == Some(IX_SYSVAR) // or DBC skips the floor fee
            {
                bought_at = Some(i);
            }
        } else if d == TRANSFER_POOL_CREATOR_DISC {
            tpc.push((a(0), a(2), a(3)));
        } else {
            msg!("launch tx calls a DBC instruction outside the allowlist");
            return Err(Error::BadLaunchTx.into());
        }
    }
    let ordered = matches!((created_at, released_at, bought_at),
        (Some(c), Some(r), Some(b)) if c < r && r < b && b < tx.current);
    if !ordered || swaps != 1 {
        msg!("tx must be: create pool, release, one pot buy into the vault, settle");
        return Err(Error::BadLaunchTx.into());
    }
    if !tpc.contains(&(pool, creator, Some(p.fee_dest))) {
        return Err(Error::NoCreatorTransfer.into());
    }
    if tokens == 0 || tokens < min_tokens {
        return Err(Error::TooFewTokens.into());
    }
    // the pool starts with no quote; the buy's fee never reaches the reserve
    if pool != Some(*pool_acc.key) || *pool_acc.owner != DBC {
        return Err(Error::BadAccount.into());
    }
    let quote = {
        let d = pool_acc.try_borrow_data()?;
        if d.len() < POOL_QUOTE_RESERVE + 8 {
            return Err(Error::BadAccount.into());
        }
        u64_at(&d, POOL_QUOTE_RESERVE)
    };
    if p.released.saturating_sub(quote) > p.released.div_ceil(100) {
        msg!("the pot's buy paid more than the 1% floor fee");
        return Err(Error::BuyMissedFloor.into());
    }
    p.total_tokens = tokens;
    p.state = SETTLED;
    p.store(presale)
}
