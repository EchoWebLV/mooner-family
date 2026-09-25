//! 5 settle_seat (spec "Settling a seat"). Solana only, permissionless.
//! A seat's lamports only ever go to `seat.user`, or exactly `commit` to the Presale
//! while FULL. A cranker who isn't the user earns its share of TX_FEE. Nothing here pays
//! a user less than a seat's rent: a smaller credit to an empty wallet fails Solana's rent
//! check, and a user could use that to block the launch.

use crate::consts::*;
use crate::error::Error;
use crate::state::*;
use crate::util::*;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

/// [cranker s w, seat w, rec(seat), user w, presale w, rec(presale), ix_sysvar]
pub fn settle_seat(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [cranker, seat, seat_record, user, presale, presale_record, sysvar, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    require_signer(cranker)?;
    let mut s = Seat::load(seat, program_id)?;
    require_home(program_id, seat, seat_record)?;
    if *user.key != s.user {
        return Err(Error::BadAccount.into());
    }
    let fee = if cranker.key == user.key {
        0
    } else {
        fee_share(TxIxs::new(sysvar)?.same_tag(program_id, IX_SETTLE_SEAT)?)
    };

    // never committed, withdrew, or left: the Presale isn't involved (it may still be
    // delegated, or already closed). The fee comes out of the refund.
    if s.commit == 0 {
        move_lamports(seat, cranker, fee.min(seat.lamports()))?;
        return close(seat, user);
    }

    if *presale.key != s.presale {
        return Err(Error::WrongPresale.into());
    }
    let mut p = Presale::load(presale, program_id)?;
    require_home(program_id, presale, presale_record)?;

    match (p.state, s.is_settled()) {
        (FULL, false) => {
            // commit -> Presale; the rest of the deposit stays in the seat and goes home
            // with its rent at claim (or refund). The pot pays the fee.
            let keep = rent(seat.data_len())?;
            if seat.lamports().checked_sub(keep).is_none_or(|x| x < s.commit) {
                return Err(Error::Overflow.into());
            }
            move_lamports(seat, presale, s.commit)?;
            move_lamports(presale, cranker, fee)?;
            p.fees_paid += fee;
            p.seats_settled += 1;
            p.settled_sum += s.commit;
            s.flags |= F_SETTLED;
            s.store(seat)?;
            p.store(presale)
        }
        (FULL, true) => Err(Error::AlreadySettled.into()),
        (EXPIRED | FAILED, false) => {
            // the whole deposit never left the seat
            move_lamports(seat, cranker, fee)?;
            p.seats_refunded += 1;
            p.store(presale)?;
            close(seat, user)
        }
        (FAILED, true) => {
            // the commit sits in the Presale, less this seat's share of the settle fees
            let payout = failed_refund(s.commit, p.fees_paid, p.settled_sum);
            move_lamports(presale, cranker, fee.min(payout))?;
            move_lamports(presale, user, payout.saturating_sub(fee))?;
            p.seats_refunded += 1;
            p.store(presale)?;
            close(seat, user)
        }
        _ => Err(Error::BadState.into()),
    }
}
