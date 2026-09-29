import type { Pfp } from '../../types';
import { Raster } from './raster';
import { BLACK } from './palette';

/** Open ellipse border preserves everything visible through jewelry and lenses. */
function ring(r: Raster, x: number, y: number, rx: number, ry: number, width: number, color: string) {
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
    if (dx*dx/(rx*rx)+dy*dy/(ry*ry) <= 1 && dx*dx/((rx-width)**2)+dy*dy/((ry-width)**2) >= 1) r.pixel(x+dx,y+dy,color);
  }
}
function gem(r: Raster, x: number, y: number, ice: boolean) {
  r.poly([[x,y-4],[x+4,y],[x,y+5],[x-4,y]], ice ? '#247caa' : '#983456');
  r.poly([[x,y-3],[x+3,y],[x,y+3]],ice ? '#83edff' : '#fc738f');
  r.poly([[x,y-3],[x,y+3],[x-3,y]],ice ? '#dcffff' : '#ffd0bf');
  r.pixel(x,y-3,'#ffffff');
}
export function drawClothes(r: Raster, p: Pfp) {
  const tones: Record<string, string[]> = {
    none: ['#494951', '#777582'],
    tee: ['#6562ac', '#9390df'],
    turtleneck: ['#202d3d', '#3a5065'],
    hoodie: ['#404f8b', '#6a85c2'],
    tux: ['#131e2c', '#344254'],
    suit: ['#6c8a9b', '#d4e5e5'],
    royal: ['#7b2852', '#b44572']
  };
  const c = tones[p.outfit] || tones.none;
  if (p.outfit === 'none') {
    return;
  }
  r.poly([[43, 100], [83, 100], [100, 114], [105, 128], [22, 128], [26, 114]], BLACK);
  r.poly([[44, 103], [80, 103], [96, 115], [102, 128], [26, 128], [29, 115]], c[0]);
  r.poly([[43, 108], [78, 108], [88, 117], [92, 128], [34, 128], [35, 118]], c[1]);
  r.line(33, 120, 31, 127, c[0], 2);
  r.line(89, 120, 92, 127, c[0], 2);
  r.line(36, 117, 39, 123, c[0]);
  r.line(84, 116, 81, 124, c[0]);
  for (let x = 35; x < 92; x += 4) r.pixel(x, 126, c[0]);
  if (p.outfit === 'tee') {
    r.poly([[45, 105], [49, 115], [63, 119], [77, 114], [81, 105], [73, 111], [54, 111]], '#45417c');
    r.rect(58, 122, 10, 2, '#c9c5fa');
  }
  if (p.outfit === 'turtleneck') {
    r.rect(47, 104, 32, 11, c[0]);
    r.line(50, 111, 76, 111, c[1]);
    r.line(51, 114, 75, 114, '#6a8190');
    for (let x = 49; x < 79; x += 4) r.line(x,106,x,114,'#526879');
  }
  if (p.outfit === 'hoodie') {
    r.poly([[40, 105], [43, 117], [54, 122], [49, 110]], '#99ace0');
    r.poly([[82, 105], [80, 117], [70, 122], [74, 110]], '#344576');
    r.line(48, 118, 48, 125, '#eef3ed');
    r.line(77, 118, 77, 126, '#eef3ed');
    r.line(55, 126, 70, 126, c[0]);
  }
  if (p.outfit === 'tux') {
    r.poly([[50, 108], [75, 108], [62, 128]], '#edf0e5');
    r.poly([[44, 107], [49, 120], [55, 119], [59, 128], [43, 117]], BLACK);
    r.poly([[80, 107], [75, 120], [69, 119], [65, 128], [82, 117]], BLACK);
    r.rect(61, 120, 2, 2, BLACK);
    r.rect(61, 125, 2, 2, BLACK);
  }
  if (p.outfit === 'suit') {
    r.ellipse(63, 109, 27, 8, '#3a5262');
    r.ellipse(63, 108, 24, 5, '#f0faf3');
    r.rect(36, 118, 15, 7, '#49768c');
    r.rect(38, 119, 4, 3, '#fb8355');
    r.rect(44, 119, 4, 3, '#82e9e4');
    r.rect(77, 117, 8, 8, '#556c80');
    r.rect(79, 119, 4, 4, '#e5c258');
    r.line(60, 119, 60, 127, '#778d9e', 2);
  }
  if (p.outfit === 'royal') {
    r.poly([[41, 106], [52, 109], [58, 128], [47, 128], [36, 113]], '#f2e8ce');
    r.poly([[84, 106], [73, 109], [68, 128], [80, 128], [90, 113]], '#f2e8ce');
    for (const [x, y] of [[42, 114], [49, 122], [79, 114], [76, 123]]) {
      r.rect(x, y, 2, 3, BLACK);
    }
    r.line(58, 119, 68, 119, '#edc45a', 2);
  }
}
export function drawNeck(r: Raster, p: Pfp) {
  if (p.neck === 'none') {
    return;
  }
  if (p.neck === 'scarf') {
    r.poly([[39, 105], [48, 109], [82, 107], [84, 115], [68, 118], [42, 114]], '#cb495f');
    r.poly([[74, 113], [84, 111], [88, 128], [78, 128]], '#e96776');
    r.line(43, 110, 78, 113, '#ff9a96', 2);
    r.line(81, 117, 84, 125, '#a42e4d', 2);
  }
  if (p.neck === 'bandana') {
    r.poly([[40, 106], [62, 112], [85, 106], [78, 119], [64, 127], [49, 117]], '#bf3f43');
    r.line(46, 111, 63, 122, '#fc967a');
    r.line(63, 122, 79, 111, '#fc967a');
    r.star(63, 117, 3, '#ffe6c2');
  }
  if (p.neck === 'bowtie') {
    r.poly([[46, 111], [59, 116], [46, 122]], '#e881ad');
    r.poly([[77, 111], [64, 116], [77, 122]], '#ad3f76');
    r.rect(59, 114, 6, 6, '#ffb3d2');
    r.line(47, 112, 55, 115, '#ffd2e7');
  }
  if (p.neck === 'chain' || p.neck === 'icechain') {
    const ice = p.neck === 'icechain';
    const dark = ice ? '#368cae' : '#a67425',
      light = ice ? '#cdffff' : '#ffe888';
    r.poly([[40, 106], [47, 114], [60, 119], [74, 116], [85, 106], [84, 113], [74, 121], [61, 124], [45, 118]], dark);
    for (const [x, y] of [[42, 108], [46, 112], [51, 116], [57, 118], [63, 120], [69, 119], [75, 117], [80, 113], [83, 109]]) {
      r.ellipse(x+1, y+1, 3, 3, dark);
      ring(r,x+1,y,3,2,1,light);
      r.pixel(x, y-1, '#ffffff');
      r.pixel(x+3,y+2,ice ? '#56c3dd' : '#dca534');
    }
    if (ice) {
      gem(r,64,123,true);
    } else {
      r.rect(60, 121, 7, 7, '#f7c546');
      r.rect(62, 123, 3, 3, '#fff19c');
      r.line(60,122,64,122,'#ffefa0');
      r.line(66,123,66,127,'#a67425');
    }
  }
}
export function drawHat(r: Raster, p: Pfp) {
  switch (p.head) {
    case 'beanie':
      r.poly([[23, 43], [27, 26], [37, 16], [58, 11], [77, 16], [89, 28], [94, 42]], BLACK);
      r.poly([[28, 36], [31, 25], [42, 18], [59, 15], [73, 18], [83, 27], [88, 38]], '#303744');
      for (let x = 35; x < 82; x += 5) {
        const top = 17 + Math.floor(Math.abs(58-x)/4);
        r.line(x,top,x-3,33,'#505968',2);
        r.line(x+2,top+1,x-1,33,'#232a36');
        r.pixel(x,top,'#71808e');
      }
      r.line(46,18,60,16,'#687584');
      r.poly([[24, 35], [52, 29], [83, 32], [93, 41], [90, 49], [60, 40], [23, 45]], '#181e28');
      for (let x = 27; x < 91; x += 4) {
        const y = x < 53 ? 37-Math.floor((x-27)/6) : 33+Math.floor((x-53)/5);
        r.line(x,y,x,y+5,'#37414f');
      }
      r.line(28, 37, 48, 33, '#5a6572');
      r.rect(47, 32, 27, 9, '#626d7a');
      r.rect(49, 33, 23, 7, '#e5e7dd');
      // A five-pixel woven label remains crisp on the native grid.
      r.rect(41, 32, 36, 9, '#151b24');
      r.line(42,32,75,32,'#88919c');
      r.line(42,40,75,40,'#4f5b69');
      drawLabel(r, 42, 34);
      break;
    case 'party':
      r.poly([[38, 32], [53, 1], [77, 28]], '#9d3a91');
      r.poly([[42, 29], [53, 3], [63, 28]], '#e98ec9');
      r.line(47, 17, 61, 15, '#ffe789', 3);
      r.line(42, 27, 68, 24, '#77e7df', 3);
      r.ellipse(53, 3, 3, 3, '#fff0a0');
      r.line(39, 32, 76, 29, '#f9d7ed', 3);
      break;
    case 'cap':
      r.poly([[28, 35], [32, 24], [43, 16], [66, 16], [82, 24], [89, 38]], '#24516d');
      r.poly([[33, 30], [42, 21], [62, 19], [74, 25], [78, 35]], '#3e85a0');
      r.line(61, 20, 64, 33, '#67bad0');
      r.ellipse(56, 26, 5, 5, '#e8d995');
      r.star(56, 26, 4, '#327187');
      r.poly([[25, 35], [60, 32], [88, 36], [95, 43], [92, 47], [66, 40], [23, 41], [17, 38]], '#142d43');
      r.line(25, 36, 62, 34, '#6fb4c2');
      break;
    case 'horns':
      r.poly([[31, 41], [25, 33], [24, 15], [31, 23], [40, 34]], '#912742');
      r.poly([[26, 19], [28, 32], [34, 37], [33, 27]], '#f87576');
      r.poly([[79, 33], [84, 22], [83, 10], [93, 24], [93, 36]], '#b63748');
      r.poly([[85, 15], [88, 27], [86, 31], [91, 32], [90, 24]], '#ff9b7d');
      break;
    case 'halo':
      ring(r,60,15,27,7,3,'#aa792d');
      ring(r,60,13,27,7,3,'#fff1a1');
      r.line(41, 9, 56, 7, '#ffffff');
      r.line(46, 19, 64, 19, '#f6ca3f');
      break;
    case 'crown':
      r.poly([[27, 33], [23, 13], [38, 23], [44, 4], [57, 23], [71, 6], [77, 28], [84, 22], [80, 37]], '#9f6c21');
      r.poly([[29, 30], [27, 19], [40, 26], [45, 9], [55, 27], [70, 12], [74, 31]], '#ffd650');
      r.poly([[46, 11], [48, 24], [55, 27]], '#fff3aa');
      r.line(30, 32, 78, 30, '#fff2a0', 3);
      r.line(31, 36, 78, 34, '#e4a331', 3);
      r.line(28,19,31,28,'#fff1a1');
      r.line(44,10,40,25,'#fff1a1');
      r.line(69,13,59,27,'#c28a2a',2);
      r.line(32,38,76,36,'#704919');
      for (const x of [34,54,74]) r.rect(x,32,2,2,'#fff6be');
      gem(r,44,31,false);
      gem(r,65,30,true);
      r.ellipse(44,5,3,3,'#fff2a0');
      r.pixel(43,4,'#ffffff');
      break;
  }
}
export function drawHeadphones(r: Raster) {
  r.line(22, 48, 24, 34, '#778baf', 3);
  r.line(24, 34, 33, 24, '#778baf', 3);
  r.line(33, 24, 50, 20, '#778baf', 3);
  r.line(50, 20, 75, 20, '#778baf', 3);
  r.line(75, 20, 92, 31, '#778baf', 3);
  r.line(92, 31, 106, 53, '#778baf', 3);
  r.rect(16, 47, 9, 22, BLACK);
  r.rect(17, 49, 7, 17, '#765ce0');
  r.rect(18, 51, 2, 12, '#b1a2ff');
  r.rect(103, 56, 9, 23, BLACK);
  r.rect(105, 58, 6, 18, '#765ce0');
  r.rect(107, 60, 2, 12, '#b1a2ff');
  r.line(28,32,35,26,'#cfdbef');
  r.line(35,26,50,22,'#cfdbef');
  r.line(51,22,74,22,'#354763',2);
  r.line(94,36,102,50,'#354763',2);
  r.rect(19,42,5,7,'#283648');
  r.rect(20,43,3,4,'#b5c6d3');
  r.rect(103,51,6,7,'#283648');
  r.rect(105,52,3,4,'#b5c6d3');
  r.rect(20,52,3,12,'#453596');
  r.rect(108,61,2,12,'#453596');
  r.line(17,66,23,66,'#342657',2);
  r.line(105,76,110,76,'#342657',2);
  for (let y=55; y<64; y+=3) r.pixel(21,y,'#ccbdff');
  r.rect(106,66,2,4,'#e8e2ff');
}
/** Five-pixel letterforms drawn as part of the hat, with no browser font rasterization. */
function drawLabel(r: Raster, x: number, y: number) {
  const letters = ['10001/11011/10101/10001/10001', '01110/10001/10001/10001/01110', '01110/10001/10001/10001/01110', '10001/11001/10101/10011/10001', '11111/10000/11110/10000/11111', '11110/10001/11110/10100/10010'];
  for (let i = 0; i < letters.length; i++) {
    letters[i].split('/').forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        if (row[dx] === '1') {
          r.pixel(x + i * 6 + dx, y + dy, '#f0f3e9');
        }
      }
    });
  }
}
export function drawEyewear(r: Raster, p: Pfp) {
  if (p.face === 'none') {
    return;
  }
  if (p.face === 'monocle') {
    ring(r,94,72,14,18,2,'#ac7833');
    ring(r,94,72,12,16,1,'#ffeaa1');
    r.line(85,60,90,56,'#fff4c3');
    r.line(102, 86, 108, 104, '#dfb953');
    r.line(108, 104, 103, 112, '#dfb953');
    r.line(99, 63, 102, 68, '#fff9dc');
    return;
  }
  if (p.face === 'hearts') {
    // The opaque backing covers the entire eye socket beneath each heart lens.
    for (const [x, y, rx, ry] of [[63, 64, 17, 21], [94, 73, 14, 18]]) {
      r.ellipse(x, y, rx, ry, '#a64283');
      r.poly([[x - rx, y - 9], [x - rx + 4, y - ry], [x - 5, y - ry], [x, y - ry + 5], [x + 5, y - ry], [x + rx - 3, y - ry + 1], [x + rx, y - 9], [x + rx - 3, y + 5], [x, y + ry], [x - rx + 3, y + 5]], '#f36fba');
      r.poly([[x - rx + 4, y - 8], [x - rx + 7, y - ry + 4], [x - 5, y - ry + 4], [x, y - ry + 10], [x + 6, y - ry + 4], [x + rx - 4, y - ry + 6], [x + rx - 3, y - 6], [x, y + ry - 5], [x - rx + 5, y + 3]], '#551a52');
      r.line(x - rx + 7, y - ry + 6, x - 5, y - ry + 6, '#ffbbdf', 2);
    }
    r.line(77, 59, 83, 62, '#f36fba', 3);
    return;
  }
  const retro = p.face === 'retro',
    visor = p.face === 'visor';
  const rim = retro ? '#f2f4e9' : visor ? '#a0eefa' : '#101c35';
  r.line(19, 48, 48, 49, rim, 3);
  r.line(22,48,46,49,'#617595');
  r.rect(43,48,5,5,'#9cadbf');
  r.poly([[45, 43], [81, 48], [82, 55], [85, 54], [113, 58], [114, 77], [109, 91], [100, 94], [86, 89], [80, 78], [74, 86], [58, 85], [48, 75]], rim);
  r.poly([[49, 47], [77, 51], [77, 68], [71, 81], [59, 80], [52, 71]], retro ? '#2448ef' : visor ? '#3d568c' : BLACK);
  r.poly([[85, 58], [109, 62], [109, 76], [104, 88], [99, 90], [89, 85], [83, 73]], retro ? '#f02a48' : visor ? '#4979aa' : BLACK);
  if (retro) {
    r.line(52, 50, 70, 53, '#407bff', 2);
    r.line(89, 62, 104, 65, '#ff6970', 2);
    r.poly([[53,61],[64,51],[68,52],[55,66]],'#81a6ff');
    r.poly([[89,74],[99,64],[102,65],[90,78]],'#ffadb0');
  } else {
    r.poly([[51, 65], [66, 50], [72, 51], [54, 72]], '#594be8');
    r.poly([[56, 77], [76, 55], [76, 62], [61, 80]], '#65deff');
    r.poly([[94, 85], [108, 65], [108, 72], [99, 88]], '#57eee1');
    r.line(48, 45, 77, 49, '#6ecafa');
    r.line(85, 56, 110, 60, '#c3ffff');
  }
  if (visor) {
    r.line(77, 51, 86, 54, '#79eafa', 4);
    r.line(59, 83, 100, 92, '#537297');
    r.rect(108, 55, 7, 3, '#ef80d2');
  }
}
