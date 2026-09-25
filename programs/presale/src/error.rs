//! Custom error codes. Append only: tests and the engine match on the numbers.

use solana_program::program_error::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    BadState = 0,          // the presale is in the wrong state for this instruction
    PastDeadline = 1,      // the presale's hour is over
    BeforeDeadline = 2,    // expire before the hour is over
    BadSeatSize = 3,       // not 0.1-1 SOL in 0.01 steps
    OverDeposit = 4,       // commit above the seat's escrowed deposit
    CreatorCannotLower = 5,
    NoRoom = 6,            // the pool has no room left
    NotAuthorized = 7,     // wrong or missing signer
    GateRequired = 8,      // entry needs the gate co-signer
    NotHome = 9,           // account is delegated (or not owned by this program)
    NotAllSettled = 10,    // release before every committed seat settled
    AlreadySettled = 11,
    NotSettled = 12,       // claim for a seat that never settled
    BadLaunchTx = 13,      // launch tx shape: order, swap count, foreign programs
    WrongDbcConfig = 14,
    NoCreatorTransfer = 15, // no transfer_pool_creator to fee_dest in the launch tx
    CostCap = 16,          // launch cost above LAUNCH_COST_CAP
    BadAccount = 17,       // an address doesn't match its derivation
    TooFewTokens = 18,
    SeatsOpen = 19,        // close while seats are still unclaimed / unrefunded
    BeforeGrace = 20,
    CommitNotZero = 21,    // leave with a live commit
    WrongPresale = 22,     // seat belongs to another presale
    NothingReleased = 23,
    Overflow = 24,
    ZeroKey = 25,
    WrongValidator = 26,
    PotNotEmpty = 27,      // the pot kept wSOL after the buy
    AlreadyExists = 28,    // seat / presale / config already created
    BadData = 29,          // instruction data length or layout
}

impl From<Error> for ProgramError {
    fn from(e: Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}
