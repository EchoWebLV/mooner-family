//! A configured program plus the usual steps: open, join, commit, fill, settle, launch.
#![allow(dead_code)]

use super::*;

pub struct Env {
    pub svm: LiteSVM,
    pub auth: Keypair, // upgrade authority
    pub admin: Keypair,
    pub gate: Keypair,
    pub gate_on: bool,
    pub bot: Keypair, // also the pot and the DBC pool creator
    pub validator: Address,
}

pub struct Opened {
    pub mint: Keypair,
    pub presale: Address,
    pub creator: Keypair,
    pub fee_dest: Address,
}

impl Env {
    /// Program + config. `gate_on` arms the entry gate.
    pub fn new(gate_on: bool) -> Env {
        let auth = Keypair::new();
        let mut svm = fresh_svm(&auth.pubkey());
        svm.airdrop(&auth.pubkey(), 10 * SOL).unwrap();
        let (admin, gate, bot) = (Keypair::new(), Keypair::new(), Keypair::new());
        svm.airdrop(&admin.pubkey(), SOL).unwrap();
        svm.airdrop(&bot.pubkey(), 10 * SOL).unwrap();
        let gate_key = if gate_on { gate.pubkey() } else { Address::default() };
        let mut e = Env { svm, auth, admin, gate, gate_on, bot, validator: er_validator() };
        let ix = ix_init_config(&e.auth.pubkey(), &e.admin.pubkey(), &gate_key, &e.bot.pubkey(), &dbc_config());
        ok(send(&mut e.svm, &e.auth, &[], &[ix]), "init_config");
        e
    }

    /// The gate account + whether it signs, for entry instructions.
    pub fn gate(&self) -> (Address, bool) {
        if self.gate_on { (self.gate.pubkey(), true) } else { (Address::default(), false) }
    }
    /// A copy of the gate key when it must co-sign (a copy, so `self.svm` stays free).
    fn gate_key(&self) -> Option<Keypair> {
        self.gate_on.then(|| self.gate.insecure_clone())
    }

    pub fn user(&mut self, sol: u64) -> Keypair {
        funded(&mut self.svm, sol * SOL)
    }

    pub fn try_open(&mut self, creator: &Keypair, mint: &Keypair, deposit: u64, commit: u64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let fee_dest = Address::new_unique();
        let ix = ix_open_presale(&creator.pubkey(), self.gate(), &mint.pubkey(), &fee_dest, &creator.pubkey(), deposit, commit);
        let gate = self.gate_key();
        let mut signers = vec![mint];
        signers.extend(gate.as_ref());
        send(&mut self.svm, creator, &signers, &[ix])
    }

    pub fn open(&mut self, deposit: u64, commit: u64) -> Opened {
        let creator = self.user(3);
        let mint = Keypair::new();
        let fee_dest = Address::new_unique();
        let ix = ix_open_presale(&creator.pubkey(), self.gate(), &mint.pubkey(), &fee_dest, &creator.pubkey(), deposit, commit);
        let gate = self.gate_key();
        let mut signers = vec![&mint];
        signers.extend(gate.as_ref());
        ok(send(&mut self.svm, &creator, &signers, &[ix]), "open_presale");
        let presale = presale_pda(&mint.pubkey());
        Opened { mint, presale, creator, fee_dest }
    }

    pub fn try_join(&mut self, user: &Keypair, presale: &Address, deposit: u64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let ix = ix_join(&user.pubkey(), self.gate(), presale, &user.pubkey(), deposit);
        let gate = self.gate_key();
        let signers: Vec<&Keypair> = gate.iter().collect();
        send(&mut self.svm, user, &signers, &[ix])
    }

    pub fn join(&mut self, user: &Keypair, presale: &Address, deposit: u64) {
        ok(self.try_join(user, presale, deposit), "join");
    }

    pub fn try_commit(&mut self, user: &Keypair, presale: &Address, amount: u64) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let seat = seat_pda(presale, &user.pubkey());
        send(&mut self.svm, user, &[], &[ix_set_commit(&user.pubkey(), &seat, presale, amount)])
    }

    pub fn commit(&mut self, user: &Keypair, presale: &Address, amount: u64) {
        ok(self.try_commit(user, presale, amount), "set_commit");
    }

    /// Opens with the creator at FULL_SEAT and fills with more FULL_SEAT buyers -> FULL
    /// (FULL_SEATS seats in all). Returns the opened presale and every buyer, creator first.
    pub fn open_full(&mut self) -> (Opened, Vec<Keypair>) {
        let o = self.open(FULL_SEAT, FULL_SEAT);
        let mut buyers = vec![o.creator.insecure_clone()];
        for _ in 1..FULL_SEATS {
            let u = self.user(2);
            self.join(&u, &o.presale, FULL_SEAT);
            self.commit(&u, &o.presale, FULL_SEAT);
            buyers.push(u);
        }
        assert_eq!(read_presale(&self.svm, &o.presale).state, FULL);
        (o, buyers)
    }

    /// FULL at uneven commits: the creator and plain buyers at FULL_SEAT, then X and Y
    /// split the last seats between them, each committing less than it deposited (X
    /// deposits MAX_SEAT, Y somewhere between). 10 SOL pool: creator 1, eight at 1, X 0.5
    /// of 1, Y 0.5 of 0.8. 0.5 SOL pool: creator 0.1, one at 0.1, X 0.15 of 0.5, Y 0.15 of
    /// 0.36. Returns (buyer, commit), creator first, X and Y last.
    pub fn open_full_uneven(&mut self) -> (Opened, Vec<(Keypair, u64)>) {
        // X and Y each take half of the last k standard seats: the fewest k that gives a
        // valid commit other than FULL_SEAT
        let k = (1..FULL_SEATS as u64)
            .find(|k| {
                let half = k * FULL_SEAT / 2;
                (k * FULL_SEAT).is_multiple_of(2 * STEP) && half >= MIN_SEAT && half <= MAX_SEAT && half != FULL_SEAT
            })
            .expect("an uneven split of the last seats");
        let half = k * FULL_SEAT / 2;
        let y_deposit = half + (MAX_SEAT - half) * 3 / 5 / STEP * STEP;
        let o = self.open(FULL_SEAT, FULL_SEAT);
        let mut buyers = vec![(o.creator.insecure_clone(), FULL_SEAT)];
        let plain = std::iter::repeat_n((FULL_SEAT, FULL_SEAT), FULL_SEATS - 1 - k as usize);
        for (deposit, commit) in plain.chain([(MAX_SEAT, half), (y_deposit, half)]) {
            let u = self.user(2);
            self.join(&u, &o.presale, deposit);
            self.commit(&u, &o.presale, commit);
            buyers.push((u, commit));
        }
        assert_eq!(read_presale(&self.svm, &o.presale).state, FULL);
        (o, buyers)
    }

    /// The bot settles every buyer's seat (as if the ER committed them all home).
    pub fn settle_all(&mut self, presale: &Address, buyers: &[Keypair]) {
        let bot = self.bot.insecure_clone();
        for b in buyers {
            let seat = seat_pda(presale, &b.pubkey());
            ok(send(&mut self.svm, &bot, &[], &[ix_settle_seat(&bot.pubkey(), &seat, &b.pubkey(), presale)]), "settle_seat");
        }
    }

    /// The whole launch tx: create pool, ATAs, release, wrap, the pot's one buy, settle,
    /// unwrap, hand the pool's creator fees to fee_dest.
    pub fn launch_ixs(&self, o: &Opened, min_tokens: u64) -> Vec<Instruction> {
        let bot = self.bot.pubkey();
        let mint = o.mint.pubkey();
        let cfg = dbc_config();
        let pot_wsol = ata(&bot, &wsol(), &token_id());
        let released = self.expected_release(o);
        vec![
            ix_compute_limit(1_400_000),
            dbc_init_pool(&cfg, &bot, &mint, &bot),
            ix_create_ata(&bot, &bot, &wsol(), &token_id()),
            ix_create_ata(&bot, &o.presale, &mint, &token22_id()),
            ix_release(&bot, &o.presale, &bot, &mint, &cfg),
            ix_sync_native(&pot_wsol),
            dbc_swap2(&cfg, &mint, &bot, &pot_wsol, &vault(&mint), released, min_tokens),
            ix_settle(&o.presale, &bot, &mint, min_tokens),
            ix_close_account(&pot_wsol, &bot, &bot),
            dbc_transfer_pool_creator(&cfg, &mint, &bot, &o.fee_dest),
        ]
    }

    /// What release will move to the pot, computed the way the program does: from the
    /// Presale's ledger, not its balance. The DBC account sizes come from a dry run of the
    /// pool creation on a copy of the chain.
    pub fn expected_release(&self, o: &Opened) -> u64 {
        let p = read_presale(&self.svm, &o.presale);
        let sizes = self.launch_sizes(o);
        let cost = LAUNCH_TX_FEE + sizes.iter().map(|l| rent(&self.svm, *l)).sum::<u64>();
        let reserve = p.seats_committed * (rent(&self.svm, sizes[4]) + TX_FEE);
        p.settled_sum - p.fees_paid - cost - reserve
    }

    /// Data sizes of [mint, pool, base_vault, quote_vault, presale_vault] after the pool
    /// and the presale vault are created (dry run on a clone).
    pub fn launch_sizes(&self, o: &Opened) -> [usize; 5] {
        let mut svm = self.svm.clone();
        let (bot, mint, cfg) = (self.bot.pubkey(), o.mint.pubkey(), dbc_config());
        let ixs = [dbc_init_pool(&cfg, &bot, &mint, &bot), ix_create_ata(&bot, &o.presale, &mint, &token22_id())];
        ok(send(&mut svm, &self.bot, &[&o.mint], &ixs), "dry-run pool creation");
        let (pool, base, quote) = pool_addresses(&cfg, &mint);
        [mint, pool, base, quote, vault(&mint)].map(|a| svm.get_account(&a).unwrap().data.len())
    }

    pub fn launch(&mut self, o: &Opened) -> TransactionMetadata {
        let ixs = self.launch_ixs(o, 1);
        let bot = self.bot.insecure_clone();
        ok(send(&mut self.svm, &bot, &[&o.mint], &ixs), "launch")
    }
}
