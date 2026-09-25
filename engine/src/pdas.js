// Program-derived addresses. Every function that derives under our program takes its id.

import { PublicKey } from "@solana/web3.js";
import { ATA_PROGRAM, BPF_UPGRADEABLE, DBC, DELEGATION_PROGRAM, TOKEN22, WSOL } from "./consts.js";

const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds, program)[0];
const utf8 = (s) => Buffer.from(s, "utf8");

export const configPda = (pid) => pda([utf8("config")], pid);
export const presalePda = (pid, mint) => pda([utf8("presale"), mint.toBuffer()], pid);
export const seatPda = (pid, presale, user) => pda([utf8("seat"), presale.toBuffer(), user.toBuffer()], pid);
export const bufferPda = (pid, acc) => pda([utf8("buffer"), acc.toBuffer()], pid);
export const programDataPda = (pid) => pda([pid.toBuffer()], BPF_UPGRADEABLE);

// MagicBlock delegation program
export const recordPda = (acc) => pda([utf8("delegation"), acc.toBuffer()], DELEGATION_PROGRAM);
export const metadataPda = (acc) => pda([utf8("delegation-metadata"), acc.toBuffer()], DELEGATION_PROGRAM);

export const ata = (owner, mint, tokenProgram) =>
  pda([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
/** The presale's Token-2022 vault for its mint. */
export const vaultOf = (presale, mint) => ata(presale, mint, TOKEN22);

// Meteora DBC
export const poolAuthority = () => pda([utf8("pool_authority")], DBC);
export const eventAuthority = () => pda([utf8("__event_authority")], DBC);

/** { pool, base, quote } for `mint` on DBC config `config`. The pool seeds put the
 *  bytewise-larger of mint / wSOL first. */
export function poolAddresses(config, mint) {
  const [hi, lo] = Buffer.compare(mint.toBuffer(), WSOL.toBuffer()) > 0 ? [mint, WSOL] : [WSOL, mint];
  const pool = pda([utf8("pool"), config.toBuffer(), hi.toBuffer(), lo.toBuffer()], DBC);
  const base = pda([utf8("token_vault"), mint.toBuffer(), pool.toBuffer()], DBC);
  const quote = pda([utf8("token_vault"), WSOL.toBuffer(), pool.toBuffer()], DBC);
  return { pool, base, quote };
}
