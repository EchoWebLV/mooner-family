//! Shared helpers: bytes, rent, PDAs, the gate, the home guard, lamport moves, the
//! instructions sysvar, and the pure money math (unit-tested at the bottom).

use crate::consts::*;
use crate::error::Error;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::Instruction,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::{instructions as ix_sysvar, Sysvar},
};
use solana_system_interface::instruction as system_instruction;

// ---- bytes ----
pub fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
pub fn i64_at(d: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
pub fn key_at(d: &[u8], o: usize) -> Pubkey {
    Pubkey::new_from_array(d[o..o + 32].try_into().unwrap())
}
pub fn put_u64(d: &mut [u8], o: usize, v: u64) {
    d[o..o + 8].copy_from_slice(&v.to_le_bytes());
}
pub fn put_i64(d: &mut [u8], o: usize, v: i64) {
    d[o..o + 8].copy_from_slice(&v.to_le_bytes());
}
pub fn put_key(d: &mut [u8], o: usize, k: &Pubkey) {
    d[o..o + 32].copy_from_slice(k.as_ref());
}

/// Exact-length instruction data, or BadData.
pub fn args<const N: usize>(rest: &[u8]) -> Result<&[u8; N], ProgramError> {
    rest.try_into().map_err(|_| Error::BadData.into())
}

pub fn rent(len: usize) -> Result<u64, ProgramError> {
    Ok(Rent::get()?.minimum_balance(len))
}

pub fn now() -> Result<i64, ProgramError> {
    Ok(solana_program::clock::Clock::get()?.unix_timestamp)
}

pub fn require_signer(acc: &AccountInfo) -> ProgramResult {
    if !acc.is_signer {
        return Err(Error::NotAuthorized.into());
    }
    Ok(())
}

pub fn require_key(acc: &AccountInfo, key: &Pubkey) -> ProgramResult {
    if acc.key != key {
        return Err(Error::BadAccount.into());
    }
    Ok(())
}

/// Entry gate: all-zero gate = open door; otherwise the gate key must co-sign.
pub fn require_gate(gate: &Pubkey, gate_signer: &AccountInfo) -> ProgramResult {
    if *gate == Pubkey::default() {
        return Ok(());
    }
    if gate_signer.key != gate || !gate_signer.is_signer {
        return Err(Error::GateRequired.into());
    }
    Ok(())
}

/// Home guard (spec "Home guard"): the account is owned by this program AND its
/// MagicBlock delegation record is empty. Inside the ER a delegated account looks
/// program-owned, but its record exists on Solana, so this fails there.
pub fn require_home(program_id: &Pubkey, acc: &AccountInfo, record: &AccountInfo) -> ProgramResult {
    if acc.owner != program_id {
        return Err(Error::NotHome.into());
    }
    let (expect, _) =
        Pubkey::find_program_address(&[DELEGATION_RECORD_SEED, acc.key.as_ref()], &DELEGATION_PROGRAM);
    if *record.key != expect {
        return Err(Error::BadAccount.into());
    }
    if !record.data_is_empty() {
        return Err(Error::NotHome.into());
    }
    Ok(())
}

/// Creates a PDA owned by `owner` holding `lamports`. Works when someone pre-funded the
/// address (create_account would fail): tops up, then allocate + assign.
#[allow(clippy::too_many_arguments)]
pub fn create_pda<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    space: usize,
    lamports: u64,
    owner: &Pubkey,
    seeds: &[&[u8]],
) -> ProgramResult {
    require_key(system, &SYSTEM)?;
    if *target.owner != SYSTEM || !target.data_is_empty() {
        return Err(Error::AlreadyExists.into());
    }
    let have = target.lamports();
    if have == 0 {
        return invoke_signed(
            &system_instruction::create_account(payer.key, target.key, lamports, space as u64, owner),
            &[payer.clone(), target.clone(), system.clone()],
            &[seeds],
        );
    }
    if have < lamports {
        invoke(
            &system_instruction::transfer(payer.key, target.key, lamports - have),
            &[payer.clone(), target.clone(), system.clone()],
        )?;
    }
    invoke_signed(&system_instruction::allocate(target.key, space as u64), &[target.clone(), system.clone()], &[seeds])?;
    invoke_signed(&system_instruction::assign(target.key, owner), &[target.clone(), system.clone()], &[seeds])
}

/// Moves lamports out of an account this program owns.
pub fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let left = from.lamports().checked_sub(amount).ok_or(Error::Overflow)?;
    let got = to.lamports().checked_add(amount).ok_or(Error::Overflow)?;
    **from.try_borrow_mut_lamports()? = left;
    **to.try_borrow_mut_lamports()? = got;
    Ok(())
}

/// Closes an account this program owns: every lamport to `dest`, data wiped, back to
/// the system program, so nothing can reuse it later in the same tx.
pub fn close(acc: &AccountInfo, dest: &AccountInfo) -> ProgramResult {
    move_lamports(acc, dest, acc.lamports())?;
    acc.try_borrow_mut_data()?.fill(0);
    acc.resize(0)?;
    acc.assign(&SYSTEM);
    Ok(())
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), token_program.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}

/// (mint, owner, amount) of a token account owned by `token_program`.
pub fn token_account(acc: &AccountInfo, token_program: &Pubkey) -> Result<(Pubkey, Pubkey, u64), ProgramError> {
    if acc.owner != token_program {
        return Err(Error::BadAccount.into());
    }
    let d = acc.try_borrow_data()?;
    if d.len() < 165 {
        return Err(Error::BadAccount.into());
    }
    Ok((key_at(&d, 0), key_at(&d, 32), u64_at(&d, 64)))
}

// ---- instructions sysvar ----
pub struct TxIxs<'a, 'b> {
    sysvar: &'a AccountInfo<'b>,
    pub count: usize,
    pub current: usize,
}

impl<'a, 'b> TxIxs<'a, 'b> {
    pub fn new(sysvar: &'a AccountInfo<'b>) -> Result<Self, ProgramError> {
        if *sysvar.key != ix_sysvar::ID {
            return Err(Error::BadAccount.into());
        }
        let count = {
            let d = sysvar.try_borrow_data()?;
            u16::from_le_bytes([d[0], d[1]]) as usize
        };
        let current = ix_sysvar::load_current_index_checked(sysvar)? as usize;
        Ok(TxIxs { sysvar, count, current })
    }

    pub fn get(&self, i: usize) -> Result<Instruction, ProgramError> {
        ix_sysvar::load_instruction_at_checked(i, self.sysvar)
    }

    /// Top-level instructions of this program with this tag in the tx (at least 1: this one).
    pub fn same_tag(&self, program_id: &Pubkey, tag: u8) -> Result<u64, ProgramError> {
        let mut n = 0u64;
        for i in 0..self.count {
            let ix = self.get(i)?;
            if ix.program_id == *program_id && ix.data.first() == Some(&tag) {
                n += 1;
            }
        }
        Ok(n.max(1))
    }
}

/// The cranker's share of one tx allowance when `same_tag` ixs share the tx.
pub fn fee_share(same_tag: u64) -> u64 {
    TX_FEE / same_tag.max(1)
}

// ---- pure money math ----

/// MIN_SEAT to MAX_SEAT in STEP steps.
pub fn valid_seat(amount: u64) -> bool {
    (MIN_SEAT..=MAX_SEAT).contains(&amount) && amount.is_multiple_of(STEP)
}

/// New commit after the room cut. `others` = raised without this seat.
/// Returns None when there is no room at all for a raise.
pub fn cut_to_room(amount: u64, current: u64, others: u64) -> Option<u64> {
    let room = TARGET.saturating_sub(others);
    if amount <= current || amount <= room {
        return Some(amount);
    }
    if room == 0 {
        return None;
    }
    Some(room)
}

/// FAILED refund of a settled seat: commit minus its share of the settle fees the pot
/// paid, rounded so the Presale never pays out more than it holds.
pub fn failed_refund(commit: u64, fees_paid: u64, settled_sum: u64) -> u64 {
    if settled_sum == 0 {
        return commit;
    }
    let num = fees_paid as u128 * commit as u128;
    let share = num.div_ceil(settled_sum as u128) as u64;
    commit.saturating_sub(share)
}

/// Pro-rata token share; the last claimer takes whatever is left.
pub fn token_share(total: u64, claimed: u64, commit: u64, raised: u64, last: bool) -> u64 {
    if last {
        return total.saturating_sub(claimed);
    }
    (total as u128 * commit as u128 / raised.max(1) as u128) as u64
}

#[cfg(all(test, not(feature = "canary")))]
mod tests {
    use super::*;

    #[test]
    fn seat_sizes() {
        assert!(valid_seat(100_000_000));
        assert!(valid_seat(500_000_000));
        assert!(valid_seat(270_000_000));
        assert!(!valid_seat(90_000_000));
        assert!(!valid_seat(510_000_000));
        assert!(!valid_seat(105_000_000));
        assert!(!valid_seat(0));
    }

    #[test]
    fn room_cut() {
        // 0.2 SOL in by others: a 0.5 SOL commit is cut to the 0.3 left
        assert_eq!(cut_to_room(500_000_000, 0, 200_000_000), Some(300_000_000));
        // lowering is never cut
        assert_eq!(cut_to_room(200_000_000, 300_000_000, 400_000_000), Some(200_000_000));
        // fits
        assert_eq!(cut_to_room(300_000_000, 0, 200_000_000), Some(300_000_000));
        // no room to raise
        assert_eq!(cut_to_room(500_000_000, 0, TARGET), None);
    }

    #[test]
    fn fee_shares() {
        assert_eq!(fee_share(1), 10_000);
        assert_eq!(fee_share(3), 3_333);
        assert_eq!(fee_share(0), 10_000);
    }

    #[test]
    fn failed_refunds_never_exceed_what_the_presale_holds() {
        // 7 of 10 seats settled before the launch failed; the pot paid 7 settle fees
        let commits = [1_000_000_000u64, 900_000_000, 330_000_000, 1_000_000_000, 450_000_000, 770_000_000, 100_000_000];
        let settled_sum: u64 = commits.iter().sum();
        let fees_paid = 7 * 3_333;
        let held = settled_sum - fees_paid;
        let paid: u64 = commits.iter().map(|c| failed_refund(*c, fees_paid, settled_sum)).sum();
        assert!(paid <= held, "paid {paid} > held {held}");
        assert!(held - paid < commits.len() as u64, "dust {} too big", held - paid);
    }

    #[test]
    fn token_shares_sum_to_total() {
        let commits = [100_000_000u64, 150_000_000, 250_000_000]; // sum to TARGET
        assert_eq!(commits.iter().sum::<u64>(), TARGET);
        let total = 123_456_789_012u64;
        let mut claimed = 0;
        for (i, c) in commits.iter().enumerate() {
            claimed += token_share(total, claimed, *c, TARGET, i == commits.len() - 1);
        }
        assert_eq!(claimed, total);
    }
}
