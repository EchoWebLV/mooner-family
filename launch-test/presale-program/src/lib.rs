//! Mooner presale vault (test program).
//!
//! Buyers deposit SOL into a presale account owned by this program. At launch, one
//! transaction creates the Meteora DBC pool, `release` moves the pooled SOL to a
//! one-time pot key's wSOL account, the pot makes ONE top-level swap whose output
//! lands directly in this program's token vault, and `settle` checks that swap
//! before the tx can succeed. Buyers then `claim` their pro-rata share from the
//! vault. No wallet ever sends tokens to another wallet.
//!
//! The swap has to be top-level (not a CPI from here) because DBC only gives the
//! first swap its minimum fee when the swap is top-level and the pool is created
//! earlier in the same transaction.
//!
//! Instructions (first data byte):
//!   0 init_presale  [authority s w, presale w, mint s, system]            data: pot(32) cap(8)
//!   1 deposit       [user s w, presale w, receipt w, system]            data: lamports(8)
//!   2 release       [authority s, presale w, pot_wsol w, ix sysvar]
//!   3 settle        [presale w, vault, pot_wsol, ix sysvar]             data: min_tokens(8)
//!   4 claim         [user s w, presale w, receipt w, vault w, user_ata w, mint, token-2022]
//!   5 withdraw      [user s w, presale w, receipt w]   (before launch: all SOL back, receipt closed)

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::{instructions as ix_sysvar, Sysvar},
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process);

const PRESALE_SEED: &[u8] = b"presale";
const RECEIPT_SEED: &[u8] = b"receipt";

const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN22: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
const DBC: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
// anchor discriminators, sha256("global:<name>")[..8]
const SWAP2_DISC: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];
const SWAP_DISCS: [[u8; 8]; 3] = [
    [248, 198, 158, 145, 225, 117, 135, 200], // swap
    SWAP2_DISC,
    [183, 93, 153, 40, 24, 230, 194, 151],    // swap2_with_transfer_hook
];
const INIT_POOL_DISCS: [[u8; 8]; 3] = [
    [140, 85, 215, 176, 102, 54, 104, 79],    // initialize_virtual_pool_with_spl_token
    [169, 118, 51, 78, 145, 110, 220, 155],   // initialize_virtual_pool_with_token2022
    [182, 13, 233, 177, 42, 145, 135, 2],     // initialize_virtual_pool_with_token2022_transfer_hook
];

const OPEN: u8 = 0;
const LAUNCHING: u8 = 1;
const SETTLED: u8 = 2;

// Presale account: version, state, bump, authority, pot, mint, cap, total_deposited,
// released, total_tokens, claimed_tokens.
const PRESALE_LEN: usize = 144;
// Receipt account: version, bump, claimed, user, amount.
const RECEIPT_LEN: usize = 48;

#[derive(Clone, Copy)]
struct Presale {
    state: u8,
    bump: u8,
    authority: Pubkey,
    pot: Pubkey,
    mint: Pubkey,
    cap: u64,
    total_deposited: u64,
    released: u64,
    total_tokens: u64,
    claimed_tokens: u64,
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}

fn key_at(d: &[u8], o: usize) -> Pubkey {
    Pubkey::new_from_array(d[o..o + 32].try_into().unwrap())
}

impl Presale {
    fn load(acc: &AccountInfo, program_id: &Pubkey) -> Result<Self, ProgramError> {
        if acc.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        let d = acc.try_borrow_data()?;
        if d.len() < PRESALE_LEN || d[0] != 1 {
            return Err(ProgramError::InvalidAccountData);
        }
        let p = Presale {
            state: d[1],
            bump: d[2],
            authority: key_at(&d, 3),
            pot: key_at(&d, 35),
            mint: key_at(&d, 67),
            cap: u64_at(&d, 99),
            total_deposited: u64_at(&d, 107),
            released: u64_at(&d, 115),
            total_tokens: u64_at(&d, 123),
            claimed_tokens: u64_at(&d, 131),
        };
        let expect = Pubkey::create_program_address(&[PRESALE_SEED, p.mint.as_ref(), &[p.bump]], program_id)
            .map_err(|_| ProgramError::InvalidSeeds)?;
        if expect != *acc.key {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(p)
    }

    fn store(&self, acc: &AccountInfo) -> ProgramResult {
        let mut d = acc.try_borrow_mut_data()?;
        d[0] = 1;
        d[1] = self.state;
        d[2] = self.bump;
        d[3..35].copy_from_slice(self.authority.as_ref());
        d[35..67].copy_from_slice(self.pot.as_ref());
        d[67..99].copy_from_slice(self.mint.as_ref());
        d[99..107].copy_from_slice(&self.cap.to_le_bytes());
        d[107..115].copy_from_slice(&self.total_deposited.to_le_bytes());
        d[115..123].copy_from_slice(&self.released.to_le_bytes());
        d[123..131].copy_from_slice(&self.total_tokens.to_le_bytes());
        d[131..139].copy_from_slice(&self.claimed_tokens.to_le_bytes());
        Ok(())
    }
}

fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), token_program.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}

/// (mint, owner, amount) of a token account owned by `token_program`.
fn token_account(acc: &AccountInfo, token_program: &Pubkey) -> Result<(Pubkey, Pubkey, u64), ProgramError> {
    if acc.owner != token_program {
        return Err(ProgramError::IllegalOwner);
    }
    let d = acc.try_borrow_data()?;
    if d.len() < 165 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok((key_at(&d, 0), key_at(&d, 32), u64_at(&d, 64)))
}

fn create_pda<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    space: usize,
    owner: &Pubkey,
    seeds: &[&[u8]],
) -> ProgramResult {
    let lamports = Rent::get()?.minimum_balance(space);
    invoke_signed(
        &system_instruction::create_account(payer.key, target.key, lamports, space as u64, owner),
        &[payer.clone(), target.clone(), system.clone()],
        &[seeds],
    )
}

fn instruction_count(sysvar: &AccountInfo) -> Result<usize, ProgramError> {
    if *sysvar.key != ix_sysvar::ID {
        return Err(ProgramError::UnsupportedSysvar);
    }
    let d = sysvar.try_borrow_data()?;
    Ok(u16::from_le_bytes([d[0], d[1]]) as usize)
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (tag, rest) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => init_presale(program_id, accounts, rest),
        1 => deposit(program_id, accounts, rest),
        2 => release(program_id, accounts),
        3 => settle(program_id, accounts, rest),
        4 => claim(program_id, accounts),
        5 => withdraw(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn init_presale(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let authority = next_account_info(it)?;
    let presale = next_account_info(it)?;
    let mint = next_account_info(it)?;
    let system = next_account_info(it)?;
    // the mint key signs, so nobody can squat the presale for a CA we announced
    if !authority.is_signer || !mint.is_signer || rest.len() != 40 || *system.key != system_program::ID {
        return Err(ProgramError::InvalidArgument);
    }
    let (expect, bump) = Pubkey::find_program_address(&[PRESALE_SEED, mint.key.as_ref()], program_id);
    if expect != *presale.key {
        return Err(ProgramError::InvalidSeeds);
    }
    create_pda(authority, presale, system, PRESALE_LEN, program_id,
               &[PRESALE_SEED, mint.key.as_ref(), &[bump]])?;
    Presale {
        state: OPEN,
        bump,
        authority: *authority.key,
        pot: key_at(rest, 0),
        mint: *mint.key,
        cap: u64_at(rest, 32),
        total_deposited: 0,
        released: 0,
        total_tokens: 0,
        claimed_tokens: 0,
    }
    .store(presale)
}

fn deposit(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let user = next_account_info(it)?;
    let presale = next_account_info(it)?;
    let receipt = next_account_info(it)?;
    let system = next_account_info(it)?;
    if !user.is_signer || rest.len() != 8 || *system.key != system_program::ID {
        return Err(ProgramError::InvalidArgument);
    }
    let lamports = u64_at(rest, 0);
    let mut p = Presale::load(presale, program_id)?;
    if p.state != OPEN || lamports == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    let (expect, bump) =
        Pubkey::find_program_address(&[RECEIPT_SEED, presale.key.as_ref(), user.key.as_ref()], program_id);
    if expect != *receipt.key {
        return Err(ProgramError::InvalidSeeds);
    }
    let before = if receipt.data_is_empty() {
        create_pda(user, receipt, system, RECEIPT_LEN, program_id,
                   &[RECEIPT_SEED, presale.key.as_ref(), user.key.as_ref(), &[bump]])?;
        0
    } else {
        if receipt.owner != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        let d = receipt.try_borrow_data()?;
        if key_at(&d, 3) != *user.key {
            return Err(ProgramError::InvalidAccountData);
        }
        u64_at(&d, 35)
    };
    let after = before.checked_add(lamports).ok_or(ProgramError::ArithmeticOverflow)?;
    if p.cap > 0 && after > p.cap {
        msg!("deposit over the per-wallet cap");
        return Err(ProgramError::InvalidArgument);
    }
    invoke(&system_instruction::transfer(user.key, presale.key, lamports),
           &[user.clone(), presale.clone(), system.clone()])?;
    {
        let mut d = receipt.try_borrow_mut_data()?;
        d[0] = 1;
        d[1] = bump;
        d[2] = 0;
        d[3..35].copy_from_slice(user.key.as_ref());
        d[35..43].copy_from_slice(&after.to_le_bytes());
    }
    p.total_deposited = p.total_deposited.checked_add(lamports).ok_or(ProgramError::ArithmeticOverflow)?;
    p.store(presale)
}

fn release(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let it = &mut accounts.iter();
    let authority = next_account_info(it)?;
    let presale = next_account_info(it)?;
    let pot_wsol = next_account_info(it)?;
    let sysvar = next_account_info(it)?;
    let mut p = Presale::load(presale, program_id)?;
    if !authority.is_signer || *authority.key != p.authority || p.state != OPEN || p.total_deposited == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    if *pot_wsol.key != ata(&p.pot, &WSOL, &TOKEN) || *pot_wsol.owner != TOKEN {
        return Err(ProgramError::InvalidAccountData);
    }
    // SOL only leaves if this same tx ends with `settle` for this presale.
    let n = instruction_count(sysvar)?;
    let current = ix_sysvar::load_current_index_checked(sysvar)? as usize;
    let mut settled_later = false;
    for i in current + 1..n {
        let ix = ix_sysvar::load_instruction_at_checked(i, sysvar)?;
        if ix.program_id == *program_id
            && ix.data.first() == Some(&3)
            && ix.accounts.first().map(|a| a.pubkey) == Some(*presale.key)
        {
            settled_later = true;
        }
    }
    if !settled_later {
        msg!("release needs a settle later in the same transaction");
        return Err(ProgramError::InvalidArgument);
    }
    **presale.try_borrow_mut_lamports()? -= p.total_deposited;
    **pot_wsol.try_borrow_mut_lamports()? += p.total_deposited;
    p.released = p.total_deposited;
    p.state = LAUNCHING;
    p.store(presale)
}

fn settle(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let it = &mut accounts.iter();
    let presale = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let pot_wsol = next_account_info(it)?;
    let sysvar = next_account_info(it)?;
    if rest.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut p = Presale::load(presale, program_id)?;
    if p.state != LAUNCHING {
        return Err(ProgramError::InvalidArgument);
    }
    if *vault.key != ata(presale.key, &p.mint, &TOKEN22) || *pot_wsol.key != ata(&p.pot, &WSOL, &TOKEN) {
        return Err(ProgramError::InvalidAccountData);
    }
    let (v_mint, v_owner, tokens) = token_account(vault, &TOKEN22)?;
    let (_, _, wsol_left) = token_account(pot_wsol, &TOKEN)?;
    if v_mint != p.mint || v_owner != *presale.key || wsol_left != 0 {
        msg!("vault is not ours, or the pot kept some SOL");
        return Err(ProgramError::InvalidAccountData);
    }
    // Walk the whole tx. It must hold: the DBC pool creation for this mint, then our
    // `release`, then exactly one DBC swap (the pot's: exact-in of everything released,
    // from the pot's wSOL into our vault), then this `settle`. Pool created in this tx +
    // the only swap in it = the pool's first swap, which DBC charges only the 1% floor.
    let n = instruction_count(sysvar)?;
    let current = ix_sysvar::load_current_index_checked(sysvar)? as usize;
    let (mut created_at, mut released_at, mut bought_at, mut swaps) = (None, None, None, 0);
    for i in 0..n {
        let ix = ix_sysvar::load_instruction_at_checked(i, sysvar)?;
        if ix.program_id == *program_id && i < current && ix.data.first() == Some(&2)
            && ix.accounts.get(1).map(|a| a.pubkey) == Some(*presale.key)
        {
            released_at = Some(i);
        }
        if ix.program_id != DBC || ix.data.len() < 8 {
            continue;
        }
        let disc: [u8; 8] = ix.data[..8].try_into().unwrap();
        if INIT_POOL_DISCS.contains(&disc) && ix.accounts.get(3).map(|a| a.pubkey) == Some(p.mint) {
            created_at = Some(i);
        }
        if SWAP_DISCS.contains(&disc) {
            swaps += 1;
            if disc == SWAP2_DISC && ix.data.len() >= 25 && ix.accounts.len() >= 10
                && u64_at(&ix.data, 8) == p.released
                && ix.data[24] == 0
                && ix.accounts[3].pubkey == *pot_wsol.key
                && ix.accounts[4].pubkey == *vault.key
                && ix.accounts[7].pubkey == p.mint
                && ix.accounts[9].pubkey == p.pot
            {
                bought_at = Some(i);
            }
        }
    }
    let ordered = match (created_at, released_at, bought_at) {
        (Some(c), Some(r), Some(b)) => c < b && r < b && b < current,
        _ => false,
    };
    if !ordered || swaps != 1 {
        msg!("tx must be: create pool, release, one pot buy into the vault, settle");
        return Err(ProgramError::InvalidArgument);
    }
    let min_tokens = u64_at(rest, 0);
    if tokens == 0 || tokens < min_tokens {
        msg!("the pot's buy returned too few tokens");
        return Err(ProgramError::InvalidArgument);
    }
    p.total_tokens = tokens;
    p.state = SETTLED;
    p.store(presale)
}

/// Checks a receipt belongs to `user` in this presale and is unspent. Returns its amount.
fn read_receipt(program_id: &Pubkey, presale: &AccountInfo, receipt: &AccountInfo, user: &AccountInfo)
    -> Result<u64, ProgramError> {
    if receipt.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let d = receipt.try_borrow_data()?;
    if d.len() < RECEIPT_LEN || d[0] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    let expect = Pubkey::create_program_address(
        &[RECEIPT_SEED, presale.key.as_ref(), user.key.as_ref(), &[d[1]]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    if expect != *receipt.key || key_at(&d, 3) != *user.key || d[2] != 0 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(u64_at(&d, 35))
}

/// Marks the receipt spent and closes it, rent back to the user.
fn close_receipt(receipt: &AccountInfo, user: &AccountInfo) -> ProgramResult {
    receipt.try_borrow_mut_data()?[2] = 1;
    let rent_back = receipt.lamports();
    **receipt.try_borrow_mut_lamports()? = 0;
    **user.try_borrow_mut_lamports()? += rent_back;
    Ok(())
}

fn withdraw(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let it = &mut accounts.iter();
    let user = next_account_info(it)?;
    let presale = next_account_info(it)?;
    let receipt = next_account_info(it)?;
    let mut p = Presale::load(presale, program_id)?;
    if !user.is_signer || p.state != OPEN {
        return Err(ProgramError::InvalidArgument);
    }
    let amount = read_receipt(program_id, presale, receipt, user)?;
    **presale.try_borrow_mut_lamports()? -= amount;
    **user.try_borrow_mut_lamports()? += amount;
    p.total_deposited = p.total_deposited.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    p.store(presale)?;
    close_receipt(receipt, user)
}

fn claim(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let it = &mut accounts.iter();
    let user = next_account_info(it)?;
    let presale = next_account_info(it)?;
    let receipt = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let user_ata = next_account_info(it)?;
    let mint = next_account_info(it)?;
    let token_program = next_account_info(it)?;
    let mut p = Presale::load(presale, program_id)?;
    if !user.is_signer || p.state != SETTLED || *mint.key != p.mint || *token_program.key != TOKEN22 {
        return Err(ProgramError::InvalidArgument);
    }
    let amount = read_receipt(program_id, presale, receipt, user)?;
    if *vault.key != ata(presale.key, &p.mint, &TOKEN22) {
        return Err(ProgramError::InvalidAccountData);
    }
    let (u_mint, u_owner, _) = token_account(user_ata, &TOKEN22)?;
    if u_mint != p.mint || u_owner != *user.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let share = ((p.total_tokens as u128) * (amount as u128) / (p.total_deposited as u128)) as u64;
    let decimals = mint.try_borrow_data()?[44];
    let mut ix_data = Vec::with_capacity(10);
    ix_data.push(12u8); // TransferChecked
    ix_data.extend_from_slice(&share.to_le_bytes());
    ix_data.push(decimals);
    let transfer = solana_program::instruction::Instruction {
        program_id: TOKEN22,
        accounts: vec![
            solana_program::instruction::AccountMeta::new(*vault.key, false),
            solana_program::instruction::AccountMeta::new_readonly(*mint.key, false),
            solana_program::instruction::AccountMeta::new(*user_ata.key, false),
            solana_program::instruction::AccountMeta::new_readonly(*presale.key, true),
        ],
        data: ix_data,
    };
    invoke_signed(&transfer,
                  &[vault.clone(), mint.clone(), user_ata.clone(), presale.clone(), token_program.clone()],
                  &[&[PRESALE_SEED, p.mint.as_ref(), &[p.bump]]])?;
    p.claimed_tokens = p.claimed_tokens.checked_add(share).ok_or(ProgramError::ArithmeticOverflow)?;
    p.store(presale)?;
    close_receipt(receipt, user)
}
