//! Mooner presale program (spec docs/superpowers/specs/2026-09-25-mooner-presale-engine-design.md).
//!
//! One Presale per mint and one Seat per wallet per presale. Seats escrow SOL on Solana;
//! commits are ledger-only changes inside a MagicBlock ER; settle_seat moves the SOL home;
//! one launch tx creates the DBC pool and buys at the 1% floor for the pot.
//!
//! Instructions (first byte), except the undelegate callback (8-byte discriminator):
//!   0 init_config   1 set_config   2 open_presale   3 join   4 delegate
//!   5 settle_seat   6 release      7 settle         8 claim  9 fail   10 close_presale
//!   11 set_commit   12 rotate_key  13 leave         14 expire
//!   15 commit_presale   16 commit_seats
//! Accounts per instruction: see each handler's doc comment.

#![allow(deprecated)]

pub mod admin;
pub mod consts;
pub mod entry;
pub mod error;
pub mod finish;
pub mod launch;
pub mod ledger;
pub mod settle_seat;
pub mod state;
pub mod util;

use borsh::BorshDeserialize;
use consts::*;
use ephemeral_rollups_sdk::cpi::undelegate_account;
use error::Error;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // MagicBlock hands a committed account back: re-create the PDA from the buffer
    // (the SDK checks the buffer is the delegation program's signed, canonical one)
    if data.len() >= 8 && data[..8] == UNDELEGATE_CALLBACK {
        let seeds = Vec::<Vec<u8>>::try_from_slice(&data[8..]).map_err(|_| Error::BadData)?;
        let [pda, buffer, payer, system, ..] = accounts else {
            return Err(Error::BadData.into());
        };
        return undelegate_account(pda, program_id, buffer, payer, system, seeds);
    }
    let (&tag, rest) = data.split_first().ok_or(Error::BadData)?;
    match tag {
        IX_INIT_CONFIG => admin::init_config(program_id, accounts, rest),
        IX_SET_CONFIG => admin::set_config(program_id, accounts, rest),
        IX_OPEN_PRESALE => entry::open_presale(program_id, accounts, rest),
        IX_JOIN => entry::join(program_id, accounts, rest),
        IX_DELEGATE => entry::delegate(program_id, accounts, rest),
        IX_SETTLE_SEAT => settle_seat::settle_seat(program_id, accounts),
        IX_RELEASE => launch::release(program_id, accounts),
        IX_SETTLE => launch::settle(program_id, accounts, rest),
        IX_CLAIM => finish::claim(program_id, accounts),
        IX_FAIL => finish::fail(program_id, accounts),
        IX_CLOSE_PRESALE => finish::close_presale(program_id, accounts),
        IX_SET_COMMIT => ledger::set_commit(program_id, accounts, rest),
        IX_ROTATE_KEY => ledger::rotate_key(program_id, accounts, rest),
        IX_LEAVE => ledger::leave(program_id, accounts),
        IX_EXPIRE => ledger::expire(program_id, accounts),
        IX_COMMIT_PRESALE => ledger::commit_presale(program_id, accounts),
        IX_COMMIT_SEATS => ledger::commit_seats(program_id, accounts),
        _ => Err(Error::BadData.into()),
    }
}
