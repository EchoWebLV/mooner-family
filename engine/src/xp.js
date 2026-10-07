// XP for the four titles (spec "XP ledger"): the titles, the level curve, what each event
// is worth, and the streak. Shared by the server (server/xp.js), the web app and the
// phone, so no node: imports.

/** The four titles, in the order screens list them. */
export const TITLES = ["dev", "kol", "raider", "diamond"];

/** XP each level starts at, levels 1 to 5 (the web's xpForLevel curve, moved here). */
export const LEVEL_XP = [0, 100, 300, 800, 2000];

/** What each event is worth and the title it counts for; `title: null` counts only in the
 *  wallet's total. The one table of points: change them here.
 *   devLaunch      you opened the presale and it launched
 *   devMigrate     ... and the coin migrated
 *   kolLaunch      you put SOL in someone else's presale and it launched
 *   kolMigrate     ... and the coin migrated
 *   raiderJoin     a wallet joined through your link, put SOL in, and the presale launched
 *   diamondMigrate at migration your wallet still held the tokens the presale gave you
 *   genesis        your Seeker Genesis Token, once */
export const POINTS = {
  devLaunch: { title: "dev", points: 100 },
  devMigrate: { title: "dev", points: 200 },
  kolLaunch: { title: "kol", points: 25 },
  kolMigrate: { title: "kol", points: 50 },
  raiderJoin: { title: "raider", points: 25 },
  diamondMigrate: { title: "diamond", points: 100 },
  genesis: { title: null, points: 250 },
};

/** The level `xp` reaches on LEVEL_XP: 1 to 5. */
export function levelOf(xp) {
  let level = 1;
  for (let l = 1; l <= LEVEL_XP.length; l++) if (xp >= LEVEL_XP[l - 1]) level = l;
  return level;
}

export const DAY_MS = 86_400_000;

/** The UTC day number of `ms` (days since 1970-01-01, UTC). */
export const utcDay = (ms) => Math.floor(ms / DAY_MS);

const dayName = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The streak from `days` (UTC day numbers with a confirmed join or open, any order,
 *  repeats fine) as of UTC day `today`: { days, best, last }. `days` is the run that ends on
 *  the latest day, while that day is today or yesterday, else 0; `best` the longest run;
 *  `last` the latest day as "YYYY-MM-DD", or null. */
export function streakOf(days, today) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  if (prev === null) return { days: 0, best: 0, last: null };
  return { days: prev >= today - 1 ? run : 0, best, last: dayName(prev) };
}
