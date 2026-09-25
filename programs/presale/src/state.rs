//! Account layouts (spec "Accounts"). Fixed byte offsets, little-endian integers.

use crate::consts::*;
use crate::error::Error;
use crate::util::{i64_at, key_at, put_i64, put_key, put_u64, u64_at};
use solana_program::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

// ---- Config ["config"] ----
pub const CONFIG_LEN: usize = 130;
pub const CONFIG_VERSION: u8 = 1;
pub const C_BUMP: usize = 1;
pub const C_ADMIN: usize = 2;
pub const C_GATE: usize = 34;
pub const C_BOT: usize = 66;
pub const C_DBC_CONFIG: usize = 98;

// ---- Presale ["presale", mint] ----
pub const PRESALE_LEN: usize = 272;
pub const PRESALE_VERSION: u8 = 2;
pub const P_STATE: usize = 1;
pub const P_BUMP: usize = 2;
pub const P_CREATOR: usize = 3;
pub const P_MINT: usize = 35;
pub const P_FEE_DEST: usize = 67;
pub const P_VALIDATOR: usize = 99;
pub const P_POT: usize = 131;
pub const P_OPENED_TS: usize = 163;
pub const P_DEADLINE_TS: usize = 171;
pub const P_FULL_TS: usize = 179;
pub const P_RAISED: usize = 187;
pub const P_SEATS_COMMITTED: usize = 195;
pub const P_SEATS_SETTLED: usize = 203;
pub const P_SEATS_REFUNDED: usize = 211;
pub const P_RELEASED: usize = 219;
pub const P_TOTAL_TOKENS: usize = 227;
pub const P_CLAIMED_TOKENS: usize = 235;
pub const P_CLAIMS_DONE: usize = 243;
pub const P_FEES_PAID: usize = 251;
pub const P_SETTLED_SUM: usize = 259;
pub const P_SPARE: usize = 267; // 5 bytes

pub const OPEN: u8 = 0;
pub const FULL: u8 = 1;
pub const LAUNCHING: u8 = 2;
pub const SETTLED: u8 = 3;
pub const EXPIRED: u8 = 4;
pub const FAILED: u8 = 5;

// ---- Seat ["seat", presale, user] ----
pub const SEAT_LEN: usize = 120;
pub const SEAT_VERSION: u8 = 1;
pub const S_BUMP: usize = 1;
pub const S_FLAGS: usize = 2;
pub const S_USER: usize = 3;
pub const S_SESSION_KEY: usize = 35;
pub const S_PRESALE: usize = 67;
pub const S_DEPOSIT: usize = 99;
pub const S_COMMIT: usize = 107;
pub const S_SPARE: usize = 115; // 5 bytes

pub const F_SETTLED: u8 = 1;
pub const F_CLAIMED: u8 = 2;
pub const F_CREATOR: u8 = 4;

fn verify_pda(program_id: &Pubkey, seeds: &[&[u8]], bump: u8, key: &Pubkey) -> Result<(), ProgramError> {
    let mut with_bump: Vec<&[u8]> = seeds.to_vec();
    let b = [bump];
    with_bump.push(&b);
    match Pubkey::create_program_address(&with_bump, program_id) {
        Ok(k) if k == *key => Ok(()),
        _ => Err(Error::BadAccount.into()),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub bump: u8,
    pub admin: Pubkey,
    pub gate: Pubkey,
    pub bot: Pubkey,
    pub dbc_config: Pubkey,
}

impl Config {
    pub fn load(acc: &AccountInfo, program_id: &Pubkey) -> Result<Self, ProgramError> {
        if acc.owner != program_id {
            return Err(Error::NotHome.into());
        }
        let d = acc.try_borrow_data()?;
        if d.len() != CONFIG_LEN || d[0] != CONFIG_VERSION {
            return Err(Error::BadAccount.into());
        }
        let c = Config {
            bump: d[C_BUMP],
            admin: key_at(&d, C_ADMIN),
            gate: key_at(&d, C_GATE),
            bot: key_at(&d, C_BOT),
            dbc_config: key_at(&d, C_DBC_CONFIG),
        };
        verify_pda(program_id, &[CONFIG_SEED], c.bump, acc.key)?;
        Ok(c)
    }

    pub fn store(&self, acc: &AccountInfo) -> Result<(), ProgramError> {
        let mut d = acc.try_borrow_mut_data()?;
        d[0] = CONFIG_VERSION;
        d[C_BUMP] = self.bump;
        put_key(&mut d, C_ADMIN, &self.admin);
        put_key(&mut d, C_GATE, &self.gate);
        put_key(&mut d, C_BOT, &self.bot);
        put_key(&mut d, C_DBC_CONFIG, &self.dbc_config);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Presale {
    pub state: u8,
    pub bump: u8,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub fee_dest: Pubkey,
    pub validator: Pubkey,
    pub pot: Pubkey,
    pub opened_ts: i64,
    pub deadline_ts: i64,
    pub full_ts: i64,
    pub raised: u64,
    pub seats_committed: u64,
    pub seats_settled: u64,
    pub seats_refunded: u64,
    pub released: u64,
    pub total_tokens: u64,
    pub claimed_tokens: u64,
    pub claims_done: u64,
    pub fees_paid: u64,
    pub settled_sum: u64,
}

impl Presale {
    /// Parses and checks the address against `["presale", mint, bump]`. No owner check:
    /// callers pick `load` (home) or `snapshot` (home or delegated).
    fn read(acc: &AccountInfo, program_id: &Pubkey) -> Result<Self, ProgramError> {
        let d = acc.try_borrow_data()?;
        if d.len() != PRESALE_LEN || d[0] != PRESALE_VERSION {
            return Err(Error::BadAccount.into());
        }
        let p = Presale {
            state: d[P_STATE],
            bump: d[P_BUMP],
            creator: key_at(&d, P_CREATOR),
            mint: key_at(&d, P_MINT),
            fee_dest: key_at(&d, P_FEE_DEST),
            validator: key_at(&d, P_VALIDATOR),
            pot: key_at(&d, P_POT),
            opened_ts: i64_at(&d, P_OPENED_TS),
            deadline_ts: i64_at(&d, P_DEADLINE_TS),
            full_ts: i64_at(&d, P_FULL_TS),
            raised: u64_at(&d, P_RAISED),
            seats_committed: u64_at(&d, P_SEATS_COMMITTED),
            seats_settled: u64_at(&d, P_SEATS_SETTLED),
            seats_refunded: u64_at(&d, P_SEATS_REFUNDED),
            released: u64_at(&d, P_RELEASED),
            total_tokens: u64_at(&d, P_TOTAL_TOKENS),
            claimed_tokens: u64_at(&d, P_CLAIMED_TOKENS),
            claims_done: u64_at(&d, P_CLAIMS_DONE),
            fees_paid: u64_at(&d, P_FEES_PAID),
            settled_sum: u64_at(&d, P_SETTLED_SUM),
        };
        verify_pda(program_id, &[PRESALE_SEED, p.mint.as_ref()], p.bump, acc.key)?;
        Ok(p)
    }

    /// Owned by this program: home on Solana, or delegated as seen inside the ER.
    pub fn load(acc: &AccountInfo, program_id: &Pubkey) -> Result<Self, ProgramError> {
        if acc.owner != program_id {
            return Err(Error::NotHome.into());
        }
        Self::read(acc, program_id)
    }

    /// The raw data on Solana, also while the account is delegated (the delegation program
    /// owns it then; the data is the state as of delegation or the last commit).
    pub fn snapshot(acc: &AccountInfo, program_id: &Pubkey) -> Result<Self, ProgramError> {
        if acc.owner != program_id && *acc.owner != DELEGATION_PROGRAM {
            return Err(Error::BadAccount.into());
        }
        Self::read(acc, program_id)
    }

    pub fn store(&self, acc: &AccountInfo) -> Result<(), ProgramError> {
        let mut d = acc.try_borrow_mut_data()?;
        d[0] = PRESALE_VERSION;
        d[P_STATE] = self.state;
        d[P_BUMP] = self.bump;
        put_key(&mut d, P_CREATOR, &self.creator);
        put_key(&mut d, P_MINT, &self.mint);
        put_key(&mut d, P_FEE_DEST, &self.fee_dest);
        put_key(&mut d, P_VALIDATOR, &self.validator);
        put_key(&mut d, P_POT, &self.pot);
        put_i64(&mut d, P_OPENED_TS, self.opened_ts);
        put_i64(&mut d, P_DEADLINE_TS, self.deadline_ts);
        put_i64(&mut d, P_FULL_TS, self.full_ts);
        put_u64(&mut d, P_RAISED, self.raised);
        put_u64(&mut d, P_SEATS_COMMITTED, self.seats_committed);
        put_u64(&mut d, P_SEATS_SETTLED, self.seats_settled);
        put_u64(&mut d, P_SEATS_REFUNDED, self.seats_refunded);
        put_u64(&mut d, P_RELEASED, self.released);
        put_u64(&mut d, P_TOTAL_TOKENS, self.total_tokens);
        put_u64(&mut d, P_CLAIMED_TOKENS, self.claimed_tokens);
        put_u64(&mut d, P_CLAIMS_DONE, self.claims_done);
        put_u64(&mut d, P_FEES_PAID, self.fees_paid);
        put_u64(&mut d, P_SETTLED_SUM, self.settled_sum);
        Ok(())
    }

    pub fn seeds_with_bump<'a>(&'a self, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
        [PRESALE_SEED, self.mint.as_ref(), bump]
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Seat {
    pub bump: u8,
    pub flags: u8,
    pub user: Pubkey,
    pub session_key: Pubkey,
    pub presale: Pubkey,
    pub deposit: u64,
    pub commit: u64,
}

impl Seat {
    /// Owned by this program (home, or delegated as seen inside the ER); address checked
    /// against `["seat", presale, user, bump]`.
    pub fn load(acc: &AccountInfo, program_id: &Pubkey) -> Result<Self, ProgramError> {
        if acc.owner != program_id {
            return Err(Error::NotHome.into());
        }
        let d = acc.try_borrow_data()?;
        if d.len() != SEAT_LEN || d[0] != SEAT_VERSION {
            return Err(Error::BadAccount.into());
        }
        let s = Seat {
            bump: d[S_BUMP],
            flags: d[S_FLAGS],
            user: key_at(&d, S_USER),
            session_key: key_at(&d, S_SESSION_KEY),
            presale: key_at(&d, S_PRESALE),
            deposit: u64_at(&d, S_DEPOSIT),
            commit: u64_at(&d, S_COMMIT),
        };
        verify_pda(program_id, &[SEAT_SEED, s.presale.as_ref(), s.user.as_ref()], s.bump, acc.key)?;
        Ok(s)
    }

    pub fn store(&self, acc: &AccountInfo) -> Result<(), ProgramError> {
        let mut d = acc.try_borrow_mut_data()?;
        d[0] = SEAT_VERSION;
        d[S_BUMP] = self.bump;
        d[S_FLAGS] = self.flags;
        put_key(&mut d, S_USER, &self.user);
        put_key(&mut d, S_SESSION_KEY, &self.session_key);
        put_key(&mut d, S_PRESALE, &self.presale);
        put_u64(&mut d, S_DEPOSIT, self.deposit);
        put_u64(&mut d, S_COMMIT, self.commit);
        Ok(())
    }

    pub fn is_creator(&self) -> bool {
        self.flags & F_CREATOR != 0
    }
    pub fn is_settled(&self) -> bool {
        self.flags & F_SETTLED != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offsets_are_packed_and_match_the_spec() {
        // each field starts where the previous one ends
        assert_eq!(C_DBC_CONFIG + 32, CONFIG_LEN);
        let presale = [
            (P_STATE, 1), (P_BUMP, 1), (P_CREATOR, 32), (P_MINT, 32), (P_FEE_DEST, 32),
            (P_VALIDATOR, 32), (P_POT, 32), (P_OPENED_TS, 8), (P_DEADLINE_TS, 8), (P_FULL_TS, 8),
            (P_RAISED, 8), (P_SEATS_COMMITTED, 8), (P_SEATS_SETTLED, 8), (P_SEATS_REFUNDED, 8),
            (P_RELEASED, 8), (P_TOTAL_TOKENS, 8), (P_CLAIMED_TOKENS, 8), (P_CLAIMS_DONE, 8),
            (P_FEES_PAID, 8), (P_SETTLED_SUM, 8), (P_SPARE, 5),
        ];
        let mut at = 1;
        for (off, len) in presale {
            assert_eq!(off, at);
            at += len;
        }
        assert_eq!(at, PRESALE_LEN);
        let seat = [
            (S_BUMP, 1), (S_FLAGS, 1), (S_USER, 32), (S_SESSION_KEY, 32), (S_PRESALE, 32),
            (S_DEPOSIT, 8), (S_COMMIT, 8), (S_SPARE, 5),
        ];
        let mut at = 1;
        for (off, len) in seat {
            assert_eq!(off, at);
            at += len;
        }
        assert_eq!(at, SEAT_LEN);
        // spec values
        assert_eq!((P_MINT, P_RAISED, P_FEES_PAID, P_SETTLED_SUM), (35, 187, 251, 259));
        assert_eq!((S_USER, S_DEPOSIT, S_COMMIT), (3, 99, 107));
    }
}
