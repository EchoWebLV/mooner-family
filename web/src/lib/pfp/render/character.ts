import { drawEyes } from './expressions';
import type { Pfp } from '../../types';
import { Raster } from './raster';
import { BLACK, palette } from './palette';
export { BLACK, palette } from './palette';
export function drawMoon(r: Raster, p: Pfp) {
  const c = palette(p.skin);
  // The visible profile is pushed right; highlights stay in a broad upper-left crescent.
  if (['none', 'halo', 'horns', 'headphones'].includes(p.head)) {
    r.poly([[31, 41], [29, 28], [43, 37]], c[0]);
    r.poly([[31, 30], [32, 39], [39, 37]], c[4]);
    r.poly([[43, 32], [43, 15], [58, 31]], c[0]);
    r.poly([[44, 17], [45, 32], [55, 30]], c[3]);
    r.line(44, 18, 44, 27, c[5], 2);
  }
  // Smiley satellite antenna, tucked behind the moon.
  r.line(91, 31, 102, 16, c[0], 3);
  r.line(91, 30, 101, 16, c[4], 2);
  r.ellipse(106, 13, 11, 11, c[0]);
  r.ellipse(106, 12, 10, 10, c[4]);
  r.ellipse(106, 12, 8, 8, BLACK);
  r.rect(102, 8, 2, 3, '#f8ee60');
  r.rect(108, 7, 2, 3, '#f8ee60');
  r.poly([[101, 13], [103, 16], [108, 16], [111, 12], [110, 17], [107, 19], [103, 18], [100, 15]], '#f8ee60');
  r.ellipse(63, 67, 46, 43, c[0]);
  r.ellipse(62, 65, 45, 43, c[1]);
  r.ellipse(61, 63, 43, 41, c[2]);
  r.ellipse(62, 61, 40, 38, c[3]);
  r.poly([[22, 53], [28, 42], [39, 32], [52, 27], [69, 25], [79, 28], [60, 28], [45, 33], [33, 43], [27, 55], [24, 77], [21, 67]], c[4]);
  r.line(34, 37, 40, 33, c[5], 2);
  r.line(45, 30, 50, 29, c[5], 2);
  r.rect(57, 26, 7, 2, c[5]);
  r.line(28, 86, 31, 93, c[4], 2);
  r.line(36, 100, 42, 103, c[3], 2);
  // Crater rims use displaced basins and a lower-right lip, not shaded balls.
  for (const [x, y, rx, ry] of [[29, 61, 6, 8], [39, 42, 5, 6], [73, 32, 7, 5], [94, 43, 5, 7], [37, 92, 7, 5], [24, 79, 3, 4]]) {
    r.ellipse(x, y, rx + 1, ry + 1, c[4]);
    r.ellipse(x, y - 1, rx, ry, c[0]);
    r.ellipse(x + 1, y, rx - 1, ry - 1, c[1]);
    r.ellipse(x + 1, y + 1, rx - 2, ry - 2, c[2]);
    r.line(x - 2, y - ry + 1, x + 1, y - ry + 1, c[0], 2);
    r.line(x, y + ry, x + 2, y + ry - 1, c[5]);
  }
  if (p.skin === 'holo') {
    r.line(27, 77, 38, 95, '#93ebed', 2);
    r.line(83, 28, 96, 40, '#f5c4ee', 2);
    r.star(46, 44, 4, '#fff4ff');
  }
  if (p.skin === 'jelly') {
    r.ellipse(45, 46, 5, 3, c[5]);
    r.rect(42, 45, 4, 1, '#ffffff');
    r.ellipse(30, 75, 2, 4, c[4]);
  }
  if (p.skin === 'chrome') {
    r.line(36, 48, 44, 41, c[5], 2);
    r.line(34, 81, 40, 89, c[0], 2);
    r.line(84, 35, 89, 39, c[5], 2);
  }
  if (p.skin === 'diamond') {
    r.poly([[24, 65], [43, 40], [40, 81]], c[4]);
    r.line(24, 65, 40, 81, c[5]);
    r.line(43, 40, 40, 81, c[5]);
    r.star(77, 39, 4, c[5]);
  }
  if (p.skin === 'lava') {
    r.line(43, 33, 48, 40, '#ffb05b');
    r.line(48, 40, 45, 47, '#ffb05b');
    r.line(26, 72, 31, 77, '#ffb05b');
    r.line(31, 77, 29, 85, '#ffb05b');
  }
  for (const [x, y] of [[33,52],[43,35],[33,83],[45,99],[88,36],[98,51]]) {
    r.rect(x, y, 2, 2, c[2]);
    r.pixel(x - 1, y - 1, c[4]);
  }
  drawEyes(r, p);
}
