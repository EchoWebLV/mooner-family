//! 8 claim, 9 fail, 10 close_presale. Solana only, permissionless.

use crate::consts::*;
use crate::error::Error;
use crate::state::*;
use crate::util::*;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    pubkey::Pubkey,
};

fn token_ix(accounts: Vec<AccountMeta>, data: Vec<u8>) -> Instruction {
    Instruction { program_id: TOKEN22, accounts, data }
}

/// [cranker s w, presale w, seat w, user w, presale_vault w, user_ata w, mint, token22,
///  ata_program, system, ix_sysvar]
/// Sends the seat's pro-rata tokens to the user's ATA (created and funded from the
/// Presale's delivery reserve if missing) and closes the seat, rent to the user.
pub fn claim(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [cranker, presale, seat, user, vault, user_ata, mint, token22, ata_program, system, sysvar, ..] = accounts
    else {
        return Err(Error::BadData.into());
    };
    require_signer(cranker)?;
    let mut p = Presale::load(presale, program_id)?;
    if p.state != SETTLED {
        return Err(Error::BadState.into());
    }
    let s = Seat::load(seat, program_id)?;
    if s.presale != *presale.key {
        return Err(Error::WrongPresale.into());
    }
    if !s.is_settled() {
        return Err(Error::NotSettled.into());
    }
    require_key(user, &s.user)?;
    require_key(mint, &p.mint)?;
    require_key(token22, &TOKEN22)?;
    require_key(ata_program, &ATA_PROGRAM)?;
    require_key(system, &SYSTEM)?;
    require_key(vault, &ata(presale.key, &p.mint, &TOKEN22))?;
    require_key(user_ata, &ata(user.key, &p.mint, &TOKEN22))?;

    // a missing ATA is paid from the reserve: the cranker fronts the shortfall inside the
    // ATA program and the Presale pays it back below. Direct lamport moves must come after
    // the last CPI: a CPI syncs only the accounts it is given, so a Presale debit made
    // before it fails the runtime's balance check (UnbalancedInstruction).
    let mut fronted = 0;
    if user_ata.data_is_empty() {
        let before = cranker.lamports();
        invoke(
            &Instruction {
                program_id: ATA_PROGRAM,
                accounts: vec![
                    AccountMeta::new(*cranker.key, true),
                    AccountMeta::new(*user_ata.key, false),
                    AccountMeta::new_readonly(*user.key, false),
                    AccountMeta::new_readonly(*mint.key, false),
                    AccountMeta::new_readonly(SYSTEM, false),
                    AccountMeta::new_readonly(TOKEN22, false),
                ],
                data: vec![1], // CreateIdempotent
            },
            &[cranker.clone(), user_ata.clone(), user.clone(), mint.clone(), system.clone(), token22.clone()],
        )?;
        // the ATA program takes only the shortfall if the address was prefunded
        fronted = before.saturating_sub(cranker.lamports()).min(rent(vault.data_len())?);
    }
    let (u_mint, u_owner, _) = token_account(user_ata, &TOKEN22)?;
    if u_mint != p.mint || u_owner != *user.key {
        return Err(Error::BadAccount.into());
    }

    let last = p.claims_done + 1 == p.seats_committed;
    let share = token_share(p.total_tokens, p.claimed_tokens, s.commit, p.raised, last);
    let decimals = mint.try_borrow_data()?[44];
    let mut data = vec![12u8]; // TransferChecked
    data.extend_from_slice(&share.to_le_bytes());
    data.push(decimals);
    let bump = [p.bump];
    invoke_signed(
        &token_ix(
            vec![
                AccountMeta::new(*vault.key, false),
                AccountMeta::new_readonly(*mint.key, false),
                AccountMeta::new(*user_ata.key, false),
                AccountMeta::new_readonly(*presale.key, true),
            ],
            data,
        ),
        &[vault.clone(), mint.clone(), user_ata.clone(), presale.clone()],
        &[&p.seeds_with_bump(&bump)],
    )?;

    let fee = if cranker.key == user.key {
        0
    } else {
        fee_share(TxIxs::new(sysvar)?.same_tag(program_id, IX_CLAIM)?)
    };
    move_lamports(presale, cranker, fronted + fee)?;
    p.claimed_tokens += share;
    p.claims_done += 1;
    p.store(presale)?;
    close(seat, user)
}

/// [presale w, rec(presale)]  FULL, home, and no launch within GRACE -> FAILED. Anyone.
pub fn fail(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [presale, presale_record, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let mut p = Presale::load(presale, program_id)?;
    require_home(program_id, presale, presale_record)?;
    if p.state != FULL {
        return Err(Error::BadState.into());
    }
    if now()? < p.full_ts + GRACE {
        return Err(Error::BeforeGrace.into());
    }
    p.state = FAILED;
    p.store(presale)
}

/// [presale w, rec(presale), creator w, presale_vault w, mint w, token22]
/// After every committed seat is claimed (SETTLED) or refunded (EXPIRED/FAILED): burns
/// stray vault tokens, closes the vault and the Presale; rent and dust to the creator.
pub fn close_presale(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [presale, presale_record, creator, vault, mint, token22, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let p = Presale::load(presale, program_id)?;
    require_home(program_id, presale, presale_record)?;
    require_key(creator, &p.creator)?;
    match p.state {
        SETTLED => {
            if p.claims_done != p.seats_committed {
                return Err(Error::SeatsOpen.into());
            }
            require_key(vault, &ata(presale.key, &p.mint, &TOKEN22))?;
            require_key(mint, &p.mint)?;
            require_key(token22, &TOKEN22)?;
            let (_, _, left) = token_account(vault, &TOKEN22)?;
            let bump = [p.bump];
            let seeds = p.seeds_with_bump(&bump);
            if left > 0 {
                let mut data = vec![8u8]; // Burn
                data.extend_from_slice(&left.to_le_bytes());
                invoke_signed(
                    &token_ix(
                        vec![
                            AccountMeta::new(*vault.key, false),
                            AccountMeta::new(*mint.key, false),
                            AccountMeta::new_readonly(*presale.key, true),
                        ],
                        data,
                    ),
                    &[vault.clone(), mint.clone(), presale.clone()],
                    &[&seeds],
                )?;
            }
            invoke_signed(
                &token_ix(
                    vec![
                        AccountMeta::new(*vault.key, false),
                        AccountMeta::new(*creator.key, false),
                        AccountMeta::new_readonly(*presale.key, true),
                    ],
                    vec![9], // CloseAccount
                ),
                &[vault.clone(), creator.clone(), presale.clone()],
                &[&seeds],
            )?;
        }
        EXPIRED | FAILED => {
            if p.seats_refunded != p.seats_committed {
                return Err(Error::SeatsOpen.into());
            }
        }
        _ => return Err(Error::BadState.into()),
    }
    close(presale, creator)
}
