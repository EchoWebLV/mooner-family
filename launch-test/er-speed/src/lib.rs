//! Devnet timing test for the Mooner presale on a MagicBlock Ephemeral Rollup (ER).
//!
//! A user's balance and a presale pool are both PDAs of this program. They are delegated to
//! the ER, SOL moves from the balance into the pool inside the ER, and then the pool is
//! committed and undelegated. The client times how long it takes until the pool is owned by
//! this program on Solana again and a Solana tx can use it (where the launch would fire).
//!
//! Instructions (first byte), except the undelegate callback (8-byte discriminator):
//!   0 init_pool      [payer s w, pool w, system]                    Solana
//!   1 init_balance   [payer s w, balance w, system]  data: u64      Solana (deposit)
//!   2 delegate       [payer s w, system, pda w, owner program, buffer w, record w,
//!                     metadata w, delegation program, validator]  data: kind u8 (0 pool, 1 balance)
//!   3 move           [payer s, balance w, pool w]    data: u64      ER (a join)
//!   4 commit_undelegate_pool [payer s w, pool w, magic program, magic context]   ER
//!   5 touch          [pool w]                                       Solana (stands in for the launch)

use borsh::BorshDeserialize;
use ephemeral_rollups_sdk::cpi::{delegate_account, undelegate_account, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};
use solana_system_interface::instruction as system_instruction;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

const UNDELEGATE_CALLBACK: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];
const SPACE: usize = 8; // a u64 counter of moves, so each commit carries a state change

fn seed_tag(kind: u8) -> Result<&'static [u8], ProgramError> {
    match kind {
        0 => Ok(b"pool"),
        1 => Ok(b"bal"),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn check_pda(program_id: &Pubkey, tag: &[u8], payer: &Pubkey, account: &AccountInfo) -> Result<u8, ProgramError> {
    let (pda, bump) = Pubkey::find_program_address(&[tag, payer.as_ref()], program_id);
    if pda != *account.key {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(bump)
}

fn u64_arg(data: &[u8]) -> Result<u64, ProgramError> {
    data.get(..8)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()))
        .ok_or(ProgramError::InvalidInstructionData)
}

fn bump_counter(account: &AccountInfo) -> ProgramResult {
    let mut d = account.try_borrow_mut_data()?;
    let n = u64::from_le_bytes(d[..8].try_into().unwrap()).wrapping_add(1);
    d[..8].copy_from_slice(&n.to_le_bytes());
    Ok(())
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() >= 8 && data[..8] == UNDELEGATE_CALLBACK {
        let seeds = Vec::<Vec<u8>>::try_from_slice(&data[8..])?;
        let [pda, buffer, payer, system, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
        return undelegate_account(pda, program_id, buffer, payer, system, seeds);
    }
    let (&tag, rest) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 | 1 => {
            let [payer, target, system, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
            let seed = seed_tag(tag)?;
            let bump = check_pda(program_id, seed, payer.key, target)?;
            let deposit = if tag == 1 { u64_arg(rest)? } else { 0 };
            let lamports = Rent::get()?.minimum_balance(SPACE) + deposit;
            invoke_signed(
                &system_instruction::create_account(payer.key, target.key, lamports, SPACE as u64, program_id),
                &[payer.clone(), target.clone(), system.clone()],
                &[&[seed, payer.key.as_ref(), &[bump]]],
            )
        }
        2 => {
            let [payer, system, pda, owner_program, buffer, record, metadata, delegation_program, validator, ..] = accounts
            else { return Err(ProgramError::NotEnoughAccountKeys) };
            let seed = seed_tag(*rest.first().ok_or(ProgramError::InvalidInstructionData)?)?;
            check_pda(program_id, seed, payer.key, pda)?;
            delegate_account(
                DelegateAccounts {
                    payer, pda, owner_program, buffer, delegation_record: record,
                    delegation_metadata: metadata, delegation_program, system_program: system,
                },
                &[seed, payer.key.as_ref()],
                DelegateConfig { validator: Some(*validator.key), ..Default::default() },
            )
        }
        3 => {
            let [payer, balance, pool, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
            if !payer.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            check_pda(program_id, b"bal", payer.key, balance)?;
            check_pda(program_id, b"pool", payer.key, pool)?;
            let amount = u64_arg(rest)?;
            **balance.try_borrow_mut_lamports()? = balance.lamports().checked_sub(amount)
                .filter(|left| *left >= Rent::get().map(|r| r.minimum_balance(SPACE)).unwrap_or(u64::MAX))
                .ok_or(ProgramError::InsufficientFunds)?;
            **pool.try_borrow_mut_lamports()? += amount;
            bump_counter(pool)
        }
        4 => {
            let [payer, pool, magic_program, magic_context, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
            if !payer.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            check_pda(program_id, b"pool", payer.key, pool)?;
            MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
                .commit_and_undelegate(&[pool.clone()])
                .build_and_invoke()
        }
        5 => {
            let [pool, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
            if pool.owner != program_id {
                return Err(ProgramError::IllegalOwner);
            }
            bump_counter(pool)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
