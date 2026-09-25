//! Inside the ER: 11 set_commit, 12 rotate_key, 13 leave, 14 expire, 15 commit_presale,
//! 16 commit_seats. No SOL moves here; only ledger numbers.
//!
//! Every instruction writes the accounts it changes on one layer: inside the ER both must
//! be delegated (writable there), on Solana both must be home. A mixed pair fails on both
//! layers, so the ledger can't split.

use crate::error::Error;
use crate::state::*;
use crate::util::*;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

fn require_seat_signer(s: &Seat, signer: &AccountInfo) -> ProgramResult {
    require_signer(signer)?;
    if *signer.key != s.user && *signer.key != s.session_key {
        return Err(Error::NotAuthorized.into());
    }
    Ok(())
}

/// [signer s, seat w, presale w]  data: amount 8
/// Sets this seat's commit to `amount` (0 = withdraw). Cut to the room left; an exact
/// fill locks the Presale FULL.
pub fn set_commit(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [signer, seat, presale, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let amount = u64_at(args::<8>(rest)?, 0);
    let mut s = Seat::load(seat, program_id)?;
    require_seat_signer(&s, signer)?;
    if *presale.key != s.presale {
        return Err(Error::WrongPresale.into());
    }
    let mut p = Presale::load(presale, program_id)?;
    if p.state != OPEN {
        return Err(Error::BadState.into());
    }
    let t = now()?;
    if t >= p.deadline_ts {
        return Err(Error::PastDeadline.into());
    }
    if amount != 0 && !valid_seat(amount) {
        return Err(Error::BadSeatSize.into());
    }
    if amount > s.deposit {
        return Err(Error::OverDeposit.into());
    }
    if s.is_creator() && amount < s.commit {
        return Err(Error::CreatorCannotLower.into());
    }
    let others = p.raised.checked_sub(s.commit).ok_or(Error::Overflow)?;
    let new = cut_to_room(amount, s.commit, others).ok_or(Error::NoRoom)?;
    match (s.commit > 0, new > 0) {
        (false, true) => p.seats_committed += 1,
        (true, false) => p.seats_committed -= 1,
        _ => {}
    }
    p.raised = others + new;
    s.commit = new;
    if p.raised == crate::consts::TARGET {
        p.state = FULL;
        p.full_ts = t;
    }
    s.store(seat)?;
    p.store(presale)
}

/// [user s, seat w]  data: session_key 32
pub fn rotate_key(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [user, seat, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let key = key_at(args::<32>(rest)?, 0);
    let mut s = Seat::load(seat, program_id)?;
    require_signer(user)?;
    if *user.key != s.user {
        return Err(Error::NotAuthorized.into());
    }
    if key == Pubkey::default() {
        return Err(Error::ZeroKey.into());
    }
    s.session_key = key;
    s.store(seat)
}

/// [payer s w, seat w, magic_program, magic_context]
/// A seat with no commit goes home, where settle_seat refunds it.
pub fn leave(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [payer, seat, magic_program, magic_context, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let s = Seat::load(seat, program_id)?;
    require_seat_signer(&s, payer)?;
    if s.commit != 0 {
        return Err(Error::CommitNotZero.into());
    }
    if s.is_creator() {
        return Err(Error::CreatorCannotLower.into());
    }
    MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
        .commit_and_undelegate(std::slice::from_ref(seat))
        .build_and_invoke()
}

/// [presale w]  OPEN past the deadline -> EXPIRED. Anyone.
pub fn expire(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [presale, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let mut p = Presale::load(presale, program_id)?;
    if p.state != OPEN {
        return Err(Error::BadState.into());
    }
    if now()? < p.deadline_ts {
        return Err(Error::BeforeDeadline.into());
    }
    p.state = EXPIRED;
    p.store(presale)
}

/// [payer s w, presale w, magic_program, magic_context]  FULL or EXPIRED -> home. Anyone.
pub fn commit_presale(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [payer, presale, magic_program, magic_context, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    require_signer(payer)?;
    let p = Presale::load(presale, program_id)?;
    if p.state != FULL && p.state != EXPIRED {
        return Err(Error::BadState.into());
    }
    MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
        .commit_and_undelegate(std::slice::from_ref(presale))
        .build_and_invoke()
}

/// [payer s w, presale, magic_program, magic_context, seat w ...]
/// Once the Presale is not OPEN, anyone sends its seats home.
pub fn commit_seats(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [payer, presale, magic_program, magic_context, seats @ ..] = accounts else {
        return Err(Error::BadData.into());
    };
    require_signer(payer)?;
    if seats.is_empty() {
        return Err(Error::BadData.into());
    }
    let p = Presale::snapshot(presale, program_id)?;
    if p.state == OPEN {
        return Err(Error::BadState.into());
    }
    for seat in seats {
        if Seat::load(seat, program_id)?.presale != *presale.key {
            return Err(Error::WrongPresale.into());
        }
    }
    MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
        .commit_and_undelegate(seats)
        .build_and_invoke()
}
