//! 2 open_presale, 3 join, 4 delegate. Solana (L1) only.

use crate::consts::*;
use crate::error::Error;
use crate::state::*;
use crate::util::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

/// [creator s w, gate_signer, config, mint s, presale w, seat w, system]
/// data: fee_dest 32, session_key 32, deposit 8, commit 8
/// Creates the Presale (OPEN, 1 hour) and the creator's Seat. The creator pays both rents
/// and escrows `deposit`; `commit` counts immediately and can never be lowered.
pub fn open_presale(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [creator, gate_signer, config, mint, presale, seat, system, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let d = args::<80>(rest)?;
    let (fee_dest, session_key) = (key_at(d, 0), key_at(d, 32));
    let (deposit, commit) = (u64_at(d, 64), u64_at(d, 72));
    require_signer(creator)?;
    // the mint key signs, so nobody can squat a presale for a CA the server announced;
    // and it can't stand in for the creator, or the server's signature would be enough
    require_signer(mint)?;
    if creator.key == mint.key {
        return Err(Error::NotAuthorized.into());
    }
    let c = Config::load(config, program_id)?;
    require_gate(&c.gate, gate_signer)?;
    if fee_dest == Pubkey::default() || session_key == Pubkey::default() {
        return Err(Error::ZeroKey.into());
    }
    if !valid_seat(commit) || deposit < commit || deposit > MAX_SEAT {
        return Err(Error::BadSeatSize.into());
    }

    let (p_key, p_bump) = Pubkey::find_program_address(&[PRESALE_SEED, mint.key.as_ref()], program_id);
    require_key(presale, &p_key)?;
    let (s_key, s_bump) = Pubkey::find_program_address(&[SEAT_SEED, p_key.as_ref(), creator.key.as_ref()], program_id);
    require_key(seat, &s_key)?;

    create_pda(creator, presale, system, PRESALE_LEN, rent(PRESALE_LEN)?, program_id,
               &[PRESALE_SEED, mint.key.as_ref(), &[p_bump]])?;
    let seat_lamports = rent(SEAT_LEN)?.checked_add(deposit).ok_or(Error::Overflow)?;
    create_pda(creator, seat, system, SEAT_LEN, seat_lamports, program_id,
               &[SEAT_SEED, p_key.as_ref(), creator.key.as_ref(), &[s_bump]])?;

    let t = now()?;
    Presale {
        state: OPEN,
        bump: p_bump,
        creator: *creator.key,
        mint: *mint.key,
        fee_dest,
        opened_ts: t,
        deadline_ts: t + DURATION,
        raised: commit,
        seats_committed: 1,
        ..Presale::default()
    }
    .store(presale)?;
    Seat { bump: s_bump, flags: F_CREATOR, user: *creator.key, session_key, presale: p_key, deposit, commit }.store(seat)
}

/// [user s w, gate_signer, config, presale, seat w, system]  data: session_key 32, deposit 8
/// Escrows `deposit` in a new Seat. The Presale is read from its raw Solana snapshot
/// (it is usually delegated): OPEN and before the deadline.
pub fn join(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [user, gate_signer, config, presale, seat, system, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let d = args::<40>(rest)?;
    let (session_key, deposit) = (key_at(d, 0), u64_at(d, 32));
    require_signer(user)?;
    let c = Config::load(config, program_id)?;
    require_gate(&c.gate, gate_signer)?;
    if session_key == Pubkey::default() {
        return Err(Error::ZeroKey.into());
    }
    if !(MIN_SEAT..=MAX_SEAT).contains(&deposit) {
        return Err(Error::BadSeatSize.into());
    }
    let p = Presale::snapshot(presale, program_id)?;
    if p.state != OPEN {
        return Err(Error::BadState.into());
    }
    if now()? >= p.deadline_ts {
        return Err(Error::PastDeadline.into());
    }
    let (s_key, s_bump) = Pubkey::find_program_address(&[SEAT_SEED, presale.key.as_ref(), user.key.as_ref()], program_id);
    require_key(seat, &s_key)?;
    let seat_lamports = rent(SEAT_LEN)?.checked_add(deposit).ok_or(Error::Overflow)?;
    create_pda(user, seat, system, SEAT_LEN, seat_lamports, program_id,
               &[SEAT_SEED, presale.key.as_ref(), user.key.as_ref(), &[s_bump]])?;
    Seat { bump: s_bump, flags: 0, user: *user.key, session_key, presale: *presale.key, deposit, commit: 0 }.store(seat)
}

/// [payer s w, pda w, owner_program, buffer w, record w, metadata w, delegation_program,
///  system, validator, presale (kind 1)]  data: kind (0 presale, 1 seat)
/// kind 0: the creator delegates the OPEN Presale and pins the ER validator (one of
/// ER_VALIDATORS).
/// kind 1: the seat's user delegates the Seat to the same validator.
pub fn delegate(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [payer, pda, owner_program, buffer, record, metadata, delegation_program, system, validator, extra @ ..] = accounts
    else {
        return Err(Error::BadData.into());
    };
    let [kind] = *args::<1>(rest)?;
    require_signer(payer)?;
    require_key(owner_program, program_id)?;
    require_key(delegation_program, &DELEGATION_PROGRAM)?;
    require_key(system, &SYSTEM)?;
    let accts = DelegateAccounts {
        payer,
        pda,
        owner_program,
        buffer,
        delegation_record: record,
        delegation_metadata: metadata,
        delegation_program,
        system_program: system,
    };
    let cfg = DelegateConfig { validator: Some(*validator.key), ..Default::default() };
    match kind {
        0 => {
            let mut p = Presale::load(pda, program_id)?;
            if *payer.key != p.creator {
                return Err(Error::NotAuthorized.into());
            }
            // OPEN only: a Presale that left the ER never goes back in
            if p.state != OPEN {
                return Err(Error::BadState.into());
            }
            // only a known MagicBlock validator: it alone can send the accounts home
            if !ER_VALIDATORS.contains(validator.key) {
                return Err(Error::WrongValidator.into());
            }
            p.validator = *validator.key;
            p.store(pda)?;
            let mint = p.mint;
            delegate_account(accts, &[PRESALE_SEED, mint.as_ref()], cfg)
        }
        1 => {
            let s = Seat::load(pda, program_id)?;
            if *payer.key != s.user {
                return Err(Error::NotAuthorized.into());
            }
            let presale = extra.first().ok_or(Error::BadData)?;
            if *presale.key != s.presale {
                return Err(Error::WrongPresale.into());
            }
            let p = Presale::snapshot(presale, program_id)?;
            if p.state != OPEN {
                return Err(Error::BadState.into());
            }
            if p.validator == Pubkey::default() || *validator.key != p.validator {
                return Err(Error::WrongValidator.into());
            }
            delegate_account(accts, &[SEAT_SEED, s.presale.as_ref(), s.user.as_ref()], cfg)
        }
        _ => Err(Error::BadData.into()),
    }
}
