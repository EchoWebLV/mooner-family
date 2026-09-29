import type { Pfp } from '../../types';
import { sanitizePfp } from '../traits';
import { Raster } from './raster';
import { drawMouth } from './expressions';
import { drawMoon } from './character';
import { drawClothes, drawNeck, drawHat, drawHeadphones, drawEyewear } from './pixel-gear';
export interface PixelPicture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
const BACKGROUNDS: Record<string, string[]> = {
  midnight: ['#141523', '#202238'],
  space: ['#080d1c', '#172447'],
  dusk: ['#332743', '#654466'],
  ocean: ['#123541', '#205d6c'],
  sunset: ['#60374a', '#b5655d'],
  forest: ['#193b34', '#2f6150'],
  ember: ['#3e222c', '#833c36'],
  candy: ['#51344f', '#965e87'],
  aurora: ['#102a39', '#286367'],
  neon: ['#26194b', '#4d3078'],
  vault: ['#352f25', '#686041'],
  galaxy: ['#271b3d', '#563569']
};
function drawBackground(r: Raster, p: Pfp) {
  const c = BACKGROUNDS[p.bg];
  if (p.bg === 'midnight') {
    r.rect(0, 0, 128, 128, '#090c12');
    return;
  }
  r.rect(0, 0, 128, 128, c[0]);
  r.ellipse(64, 66, 72, 65, c[1]);
  r.ellipse(64, 62, 62, 56, c[0]);
  if (p.bg === 'sunset') {
    r.rect(0, 89, 128, 12, '#925261');
    r.rect(0, 101, 128, 27, '#bf7765');
  }
  if (p.bg === 'ocean' || p.bg === 'forest') {
    for (let i = 0; i < 6; i++) {
      r.poly([[i * 27 - 15, 128], [i * 27, 93 + i % 2 * 8], [i * 27 + 23, 128]], c[1]);
    }
  }
  if (p.bg === 'aurora') {
    r.poly([[0, 38], [30, 9], [57, 7], [35, 22], [0, 64]], '#348976');
    r.poly([[77, 0], [111, 0], [128, 26], [128, 42], [100, 12]], '#5f658d');
  }
  if (p.bg === 'neon') {
    for (let y = 96; y < 128; y += 8) {
      r.line(0, y, 127, y, '#634582');
    }
    for (let x = -64; x < 200; x += 32) {
      r.line(64, 87, x, 127, '#634582');
    }
    r.rect(6, 12, 2, 56, '#a953af');
    r.rect(120, 48, 2, 44, '#47b8c4');
  }
  if (p.bg === 'vault') {
    for (let x = 8; x < 128; x += 22) {
      r.line(x, 0, x, 127, '#494230');
    }
    r.rect(7, 7, 114, 2, '#827b4e');
    r.rect(7, 119, 114, 2, '#827b4e');
  }
  if (p.bg === 'galaxy') {
    r.poly([[0, 90], [0, 63], [86, 0], [122, 0]], '#462957');
    r.poly([[0, 79], [0, 73], [99, 0], [112, 0]], '#70446d');
  }
  if (p.bg === 'space' || p.bg === 'galaxy' || p.bg === 'midnight') {
    for (const [x, y] of [[12, 17], [31, 9], [120, 32], [9, 89], [114, 112], [20, 118], [84, 7], [10, 46], [119, 91]]) {
      r.pixel(x, y, '#6c7a9d');
      if (p.bg !== 'midnight') {
        r.pixel(x + 1, y, '#6c7a9d');
      }
    }
    if (p.bg !== 'midnight') {
      r.star(15, 28, 3, '#adb9d2');
    }
  }
}
/** The art is always authored at 128 pixels; larger outputs repeat pixels without interpolation. */
export function renderPixels(raw: Pfp, size = 128): PixelPicture {
  if (![128, 256, 512].includes(size)) {
    throw new Error('Picture size must be 128, 256 or 512');
  }
  const p = sanitizePfp(raw),
    r = new Raster();
  drawBackground(r, p);
  if (p.aura === 'glow') {
    r.ellipse(63, 67, 53, 49, '#343a5a');
    r.ellipse(63, 67, 50, 47, '#586684');
    r.ellipse(63, 67, 48, 45, '#92a7b7');
  }
  if (p.aura === 'ring') {
    r.poly([[7, 86], [10, 77], [25, 67], [103, 47], [119, 48], [123, 54], [117, 63], [112, 61], [119, 53], [104, 51], [28, 71], [13, 79], [11, 85]], '#a995d1');
    r.line(13, 77, 23, 71, '#ece0ff', 2);
  }
  drawClothes(r, p);
  drawNeck(r, p);
  drawMoon(r, p);
  drawMouth(r, p);
  if (p.head === 'headphones') {
    drawHeadphones(r);
  } else drawHat(r, p);
  drawEyewear(r, p);
  if (p.aura === 'sparkles') {
    for (const [x, y, s] of [[12, 42, 5], [115, 96, 6], [33, 13, 4], [16, 110, 3], [118, 43, 3]]) {
      r.star(x, y, s, '#d7b7ff');
      r.star(x, y, s - 2, '#ffffff');
    }
  }
  if (p.aura === 'ring') {
    r.poly([[8, 84], [15, 88], [32, 88], [62, 83], [95, 71], [117, 59], [121, 54], [119, 64], [97, 77], [65, 88], [35, 94], [15, 94], [7, 90]], '#8e76b8');
    r.poly([[10, 85], [16, 89], [32, 89], [63, 84], [97, 72], [117, 61], [116, 65], [97, 75], [64, 87], [34, 92], [15, 92]], '#e6d3f5');
    r.line(17, 92, 30, 92, '#ffffff');
  }
  if (size === 128) {
    return {
      width: 128,
      height: 128,
      data: r.data
    };
  }
  const data = new Uint8ClampedArray(size * size * 4),
    scale = size / 128;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (Math.floor(y / scale) * 128 + Math.floor(x / scale)) * 4;
      data.set(r.data.subarray(from, from + 4), (y * size + x) * 4);
    }
  }
  return {
    width: size,
    height: size,
    data
  };
}
