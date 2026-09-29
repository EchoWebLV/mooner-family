export const BLACK = '#080b12';
/** Six intentional material bands: rim, shade, midtone, body, light and glint. */
const PALETTES: Record<string, string[]> = {
  moon: ['#737984', '#a2a7ad', '#c9cdd1', '#e3e6e6', '#f4f5ed', '#ffffff'],
  lilac: ['#665288', '#9375b6', '#b898d4', '#d3b4ee', '#ebd5ff', '#fff4ff'],
  mint: ['#367d70', '#57a48b', '#81c7a7', '#a5e9c1', '#d2f8db', '#f0fff1'],
  peach: ['#a46a61', '#ca8b77', '#e9ae90', '#ffd0ad', '#ffe5c9', '#fff8e9'],
  sky: ['#287fa5', '#35acd0', '#62d4ed', '#93e9f5', '#c7fbff', '#ffffff'],
  lemon: ['#a08a35', '#c5af4e', '#e4d765', '#f4ed8d', '#fff8b5', '#fffde8'],
  coral: ['#ae414c', '#d76268', '#eb8180', '#ffa59b', '#ffc8af', '#ffeadd'],
  rose: ['#a33c7b', '#ca5f9b', '#e684b5', '#f59bca', '#ffc0df', '#ffe5f4'],
  lime: ['#318f34', '#5dc33a', '#8bea40', '#b8fa5c', '#ddff88', '#f5ffc5'],
  cocoa: ['#442d38', '#6f4950', '#926556', '#b98668', '#dbb083', '#f4d9ab'],
  teal: ['#195b6a', '#227f88', '#31a3a2', '#4fc4b4', '#86e4cf', '#c4fff0'],
  clay: ['#705656', '#95786c', '#b2967f', '#cdb795', '#e5d2b3', '#fff0d8'],
  ink: ['#17182c', '#292b47', '#424362', '#5b5c7f', '#8586a8', '#c9cbe7'],
  holo: ['#6255ab', '#8684dd', '#8fb9e6', '#b7e9e6', '#f0c8f2', '#ffffff'],
  jelly: ['#5e2c91', '#9c3fb8', '#c264cf', '#e292e5', '#fbc3ef', '#fff2ff'],
  obsidian: ['#101516', '#1c2629', '#2d393b', '#404c4b', '#697773', '#a9bab1'],
  chrome: ['#3b5367', '#60798b', '#96a9b1', '#c9d6d7', '#edf9f6', '#ffffff'],
  gold: ['#996020', '#c48a29', '#e6b237', '#ffcf4e', '#ffe786', '#fff6ce'],
  diamond: ['#257aaf', '#47afd1', '#8fdcE5', '#bceff1', '#defcfa', '#ffffff'],
  lava: ['#73152c', '#a72331', '#ce3234', '#ef493b', '#ff8453', '#ffd995']
};
export function palette(skin: string) {
  return PALETTES[skin] || PALETTES.moon;
}
