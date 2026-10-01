// Content banks for the simulator: bot handles, token ideas, and chat lines.
import type { Title } from '../types'

export const BOT_HANDLES: readonly string[] = [
  'degen_sato', 'moonwalker', 'gigabrain', 'solsister', 'apecommander', 'chartjester',
  'lowcap_larry', 'bagholder_bex', 'mintmaxxer', 'pumpologist', 'wenlambo', 'cryptokaiju',
  'based_banshee', 'liquidlad', 'frogmancer', 'satoshi_snacks', 'alpha_otter', 'beta_badger',
  'gamma_gecko', 'delta_dingo', 'sigma_seal', 'vibe_merchant', 'callooor', 'raidboss_ray',
  'shillvania', 'diamond_dana', 'paperhands_pete', 'hodl_hana', 'stakemeister', 'gm_goblin',
  'nightowl', 'sol_surfer', 'ticker_tapper', 'curve_bill', 'presale_pat', 'ape_in_amy',
  'fomo_felix', 'tenx_tina', 'dip_buyer_dom', 'whale_watcher', 'shrimp_king', 'memelord_mo',
  'thread_queen', 'reply_guy_rex', 'quote_quinn', 'lurk_lord', 'candle_carl', 'wick_hunter',
  'rocket_rosa', 'orbit_ollie', 'nova_nik', 'pixel_priya', 'ser_sven', 'kaiju_kim',
  'lambo_lu', 'mooncat', 'turbo_tess', 'vanguard_vic', 'oracle_oz', 'legion_leo',
]

export interface TokenIdea {
  name: string
  ticker: string
  description: string
  /** The meme a spin-off is named after ("Baby Pepe" → PEPE); an original's is its own ticker. */
  meme?: string
}

/** Named after real internet memes, the way memecoins are. Tickers are unique. */
export const TOKEN_IDEAS: readonly TokenIdea[] = [
  { name: 'Pepe', ticker: 'PEPE', description: 'Feels good, man.' },
  { name: 'Doge', ticker: 'DOGE', description: 'Such crew. Very presale. Wow.' },
  { name: 'Wojak', ticker: 'WOJAK', description: 'Bought the top again. Feels bad.' },
  { name: 'Chill Guy', ticker: 'CHILLGUY', description: 'Lowkey does not care about the chart.' },
  { name: 'Moo Deng', ticker: 'MOODENG', description: 'Bouncy, spicy, zoo famous.' },
  { name: 'Popcat', ticker: 'POPCAT', description: 'Pop. Pop. Pop.' },
  { name: 'Pnut', ticker: 'PNUT', description: 'Justice for the squirrel.' },
  { name: 'Bonk', ticker: 'BONK', description: 'Bonk the bears.' },
  { name: 'dogwifhat', ticker: 'WIF', description: 'It is literally a dog wif a hat.' },
  { name: 'Gigachad', ticker: 'GIGA', description: 'Average presale enjoyer.' },
  { name: 'Nyan Cat', ticker: 'NYAN', description: 'Rainbow trail, eight-bit loop.' },
  { name: 'Grumpy Cat', ticker: 'GRUMPY', description: 'No.' },
  { name: 'Trollface', ticker: 'TROLL', description: 'Problem?' },
  { name: 'Stonks', ticker: 'STONKS', description: 'Line goes up.' },
  { name: 'This Is Fine', ticker: 'FINE', description: 'Chart on fire. This is fine.' },
  { name: 'Doomer', ticker: 'DOOMER', description: 'It is so over.' },
  { name: 'Bloomer', ticker: 'BLOOMER', description: 'We are so back.' },
  { name: 'Sigma', ticker: 'SIGMA', description: 'Grindset only.' },
  { name: 'Rizz', ticker: 'RIZZ', description: 'Unspoken rizz, spoken chart.' },
  { name: 'Skibidi', ticker: 'SKIBIDI', description: 'Nobody knows what it means. Everyone is in.' },
  { name: 'Mog', ticker: 'MOG', description: 'Mogging every chart on Pulse.' },
  { name: 'Keyboard Cat', ticker: 'KEYCAT', description: 'Plays the paper hands off.' },
  { name: 'Brett', ticker: 'BRETT', description: "Pepe's best friend." },
  { name: 'Michi', ticker: 'MICHI', description: 'A cat with a plan.' },
  { name: 'Pengu', ticker: 'PENGU', description: 'Waddling to migration.' },
  { name: 'Capybara', ticker: 'CAPY', description: 'Unbothered. In the presale.' },
  { name: 'Big Floppa', ticker: 'FLOPPA', description: 'Big cat, bigger bags.' },
  { name: 'Cheems', ticker: 'CHEEMS', description: 'Much bonk, very cheemsburger.' },
  { name: 'Bingus', ticker: 'BINGUS', description: 'Hairless and fearless.' },
  { name: 'Walter', ticker: 'WALTER', description: 'Likes monster trucks and green candles.' },
  { name: 'Monke', ticker: 'MONKE', description: 'Return to monke.' },
  { name: 'Hampter', ticker: 'HAMPTER', description: 'Small, round, unstoppable.' },
  { name: 'Maxwell', ticker: 'MAXWELL', description: 'Spinning cat, spinning chart.' },
  { name: 'Wen Lambo', ticker: 'LAMBO', description: 'Asking the only question that matters.' },
  { name: 'NPC', ticker: 'NPC', description: 'Buys whatever chat is buying.' },
  { name: 'Deal With It', ticker: 'SHADES', description: 'Pixel shades on.' },
  { name: 'Sus', ticker: 'SUS', description: 'Emergency meeting: who sold?' },
  { name: 'Galaxy Brain', ticker: 'GBRAIN', description: 'Thinking three candles ahead.' },
  { name: 'Diamond Hands', ticker: 'DIAMOND', description: 'Never selling. Ever.' },
  { name: 'WAGMI', ticker: 'WAGMI', description: 'We are all gonna make it.' },
  { name: 'Goose', ticker: 'HONK', description: 'Peace was never an option.' },
  { name: 'Smudge', ticker: 'SMUDGE', description: 'Salad? No. Green candles.' },
  { name: 'Soyjak', ticker: 'SOYJAK', description: 'Pointing at the chart.' },
  { name: 'Goblin Mode', ticker: 'GOBLIN', description: 'Unwashed, unbothered, all in.' },
  { name: 'Touch Grass', ticker: 'GRASS', description: 'Log off. The crew has it.' },
  { name: 'Number Go Up', ticker: 'NGU', description: 'The whole thesis.' },
  { name: 'Laser Eyes', ticker: 'LASER', description: 'Focused. Very focused.' },
  { name: 'Few Understand', ticker: 'FEW', description: 'You would not get it.' },
  { name: 'Up Only', ticker: 'UPONLY', description: 'Down is not an option.' },
  { name: 'GM', ticker: 'GM', description: 'Good morning, every morning.' },
  { name: 'Shiba', ticker: 'SHIBA', description: "Doge's little cousin." },
  { name: 'Hodl', ticker: 'HODL', description: 'Nobody leaves the house.' },
]

/** {t} → a $TICKER, {n} → a number, {p} → curve progress % */
export const GLOBAL_LINES: readonly string[] = [
  'gm',
  '{t} presale almost full, get in',
  'anyone running a raid on {t} tonight?',
  'who is in the {t} presale',
  'LFG {t}',
  'missed {t} again, next presale I am in',
  '{t} chart is a staircase',
  'that {t} migration was clean',
  'hit Launch and got dropped into {t} lol',
  '{t} timer is ticking, fill it',
  '{t} to migration today?',
  'same price as the dev on {t}, love that',
  'no snipers on {t}, clean launch',
  'just hit a new badge, feels good',
  '{n} people in the {t} presale rn',
  'who is top of the leaderboard today',
  'presale meta is fun',
]

export const TITLE_LINES: Record<Title, readonly string[]> = {
  kol: [
    'calling it now: {t} migrates within the hour',
    'my timeline keeps asking about {t}',
    '{t} is my call of the day',
  ],
  diamond: [
    'not selling {t} till migration',
    'held {t} through the dip, still here',
    'paper hands left {t} early lol',
  ],
  shiller: [
    'new {t} meme dropping in 5',
    'wrote a thread on {t}, go like it',
    '{t} content is writing itself',
  ],
  raider: [
    'raid on {t} starts now, drop links',
    '{n} replies in 2 min on the {t} post',
    'raiders to {t}',
  ],
}

export const PRESALE_LINES: readonly string[] = [
  'lets fill this',
  "who's putting in more?",
  'lets gooo',
  'almost there',
  "I'll top up if we're short",
  'this presale is stacked',
  'Diamond Hands reporting in',
  'same price for everyone, love it',
  'invite your friends, timer is ticking',
  'no snipers here',
]

export const TOKEN_LINES: readonly string[] = [
  'holding',
  'chart looks clean',
  '{p} to migration',
  'bought more',
  'who sold lol',
  'diamond hands only',
  'next leg up soon',
  'crew still holding strong',
  'migration party when',
  'just aped 0.5',
]
