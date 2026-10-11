# MagicBlock ER exit speed — devnet, 2026-09-25

How long a presale pool takes to leave a MagicBlock Ephemeral Rollup and be usable on Solana again.

**Setup**
- Program `DwUdqmmLPbmNGzeovUAmfojqjPjzH9ZZuSsyk2Trk4gj` on devnet (`src/lib.rs`); the client is `speed.mjs`.
- Validators run magicblock-core 0.16.0 (commit e66d914), the same build as the mainnet ERs.
- Each round:
  - joins move SOL from a delegated balance PDA into a delegated pool PDA inside the ER;
  - the pool is committed and undelegated;
  - Solana is polled until the pool is back with the new SOL;
  - a Solana tx writes the pool. That tx stands in for the launch.

**Results** (8 rounds per region; ping = this machine's round trip to the ER)

| ER | ping | join inside the ER | pool back on Solana, from sending the exit | launch tx confirmed, from sending the exit |
|---|---|---|---|---|
| devnet-as | 31 ms | 62–117 ms | 0.76–1.19 s (median 0.86) | 1.59–1.98 s in 6 rounds; 10.5 s and 14.4 s in 2 |
| devnet-eu | 194 ms | 384–402 ms | 0.67–0.96 s (median 0.90) | 1.30–1.75 s in 7 rounds; 9.4 s in 1 |
| devnet-us | 267 ms | 532–944 ms | 0.91–3.02 s (median 1.01) | 1.39–3.81 s (median 1.84) |

**What the numbers show**
- **Join time is network distance.** A join takes about two pings from the client to the ER.
- **The validator exits the pool in one Solana tx.** In the one tx I inspected, the validator:
  - committed the pool and undelegated it in that single tx;
  - paid the pool's SOL gain from its own wallet: its balance went from 13.4167 to 13.4017 SOL for the 0.015 SOL of joins.
- **The slow launch rounds are my checker, not the network.** For the two slow Asia rounds, the launch tx landed 5 and 3 slots after the validator's exit tx. All 8 Asia rounds landed 3–6 slots after. The time went to my status polling, which was retrying through devnet's public RPC rate limit (429s). The EU 9.4 s round wasn't saved, so it isn't checked.
- **Getting the pool into the ER took 1–16 s.** Almost all of that was the delegate tx landing on devnet through the public RPC. The first join after delegation succeeded on the first try in most rounds.

**Not yet measured:** mainnet. Mainnet Solana is busier, and it is unknown what priority fee MagicBlock's mainnet validators put on their exit txs.
