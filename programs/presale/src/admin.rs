//! 0 init_config, 1 set_config.

use crate::consts::*;
use crate::error::Error;
use crate::state::*;
use crate::util::*;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

struct Keys {
    admin: Pubkey,
    gate: Pubkey,
    bot: Pubkey,
    dbc_config: Pubkey,
}

fn parse(rest: &[u8]) -> Result<Keys, solana_program::program_error::ProgramError> {
    let d = args::<128>(rest)?;
    let k = Keys { admin: key_at(d, 0), gate: key_at(d, 32), bot: key_at(d, 64), dbc_config: key_at(d, 96) };
    // gate may be zero (open entry); the others may not
    if k.admin == Pubkey::default() || k.bot == Pubkey::default() || k.dbc_config == Pubkey::default() {
        return Err(Error::ZeroKey.into());
    }
    Ok(k)
}

/// [authority s w, config w, program_data, system]  data: admin, gate, bot, dbc_config
/// Only the program's upgrade authority (read from ProgramData) can create the Config.
pub fn init_config(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [authority, config, program_data, system, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    require_signer(authority)?;
    let k = parse(rest)?;
    let (pd, _) = Pubkey::find_program_address(&[program_id.as_ref()], &BPF_UPGRADEABLE);
    if *program_data.key != pd || *program_data.owner != BPF_UPGRADEABLE {
        return Err(Error::BadAccount.into());
    }
    {
        // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority: Option<Pubkey> }
        let d = program_data.try_borrow_data()?;
        if d.len() < 45 || d[0..4] != [3, 0, 0, 0] || d[12] != 1 || key_at(&d, 13) != *authority.key {
            return Err(Error::NotAuthorized.into());
        }
    }
    let (expect, bump) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    require_key(config, &expect)?;
    create_pda(authority, config, system, CONFIG_LEN, rent(CONFIG_LEN)?, program_id, &[CONFIG_SEED, &[bump]])?;
    Config { bump, admin: k.admin, gate: k.gate, bot: k.bot, dbc_config: k.dbc_config }.store(config)
}

/// [admin s, config w]  data: admin, gate, bot, dbc_config
pub fn set_config(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(Error::BadData.into());
    };
    let mut c = Config::load(config, program_id)?;
    require_signer(admin)?;
    if *admin.key != c.admin {
        return Err(Error::NotAuthorized.into());
    }
    let k = parse(rest)?;
    c.admin = k.admin;
    c.gate = k.gate;
    c.bot = k.bot;
    c.dbc_config = k.dbc_config;
    c.store(config)
}
