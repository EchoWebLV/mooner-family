import type { Pfp } from '../../types';
import { Raster } from './raster';
import { BLACK, palette } from './palette';
export function drawClassicEyes(r: Raster, p: Pfp) {
  const c = palette(p.skin);
  for (const [x, y, rx, ry] of [[64, 64, 15, 19], [94, 73, 12, 16]]) {
    r.ellipse(x, y, rx + 1, ry + 1, c[0]);
    r.ellipse(x + 1, y, rx, ry, c[5]);
    r.ellipse(x - 2, y, rx - 2, ry, BLACK);
    r.line(x + rx - 3, y - 8, x + rx - 2, y + 4, c[2]);
    if (p.eyes === 'heart') {
      r.poly([[x - 9, y - 4], [x - 6, y - 8], [x - 2, y - 7], [x, y - 4], [x + 3, y - 7], [x + 7, y - 6], [x + 8, y - 2], [x + 5, y + 4], [x - 1, y + 10], [x - 8, y + 2]], '#ff405c');
      r.rect(x - 6, y - 6, 3, 2, '#ff9d9f');
    } else if (p.eyes === 'diamond') {
      r.poly([[x - 8, y - 3], [x - 4, y - 8], [x + 4, y - 8], [x + 8, y - 3], [x, y + 9]], '#46dcee');
      r.poly([[x - 4, y - 7], [x, y + 7], [x, y - 3], [x + 3, y - 7]], '#ecffff');
      r.line(x - 7, y - 3, x + 7, y - 3, '#a2faff');
    } else if (p.eyes === 'laser') {
      r.ellipse(x, y, 8, 5, '#92192c');
      r.line(x - 8, y, x + 8, y, '#ff3348', 3);
      r.line(x - 6, y + 1, x + 7, y + 1, '#fff3e2');
    } else {
      const colors: Record<string, string> = {
        star: p.skin === 'obsidian' ? '#a4ff60' : '#ffffff',
        ice: '#8cffff',
        pink: '#ff96de',
        gold: '#ffe367',
        cosmic: '#faf4ff'
      };
      if (p.eyes === 'cosmic') {
        r.star(x - 1, y, 11, '#6a55ee');
        r.star(x - 1, y, 8, '#ec67db');
        r.rect(x - 8, y - 10, 2, 2, '#66f1ee');
        r.pixel(x + 5, y + 10, '#ffe994');
      }
      r.star(x - 1, y, 7, colors[p.eyes] || '#ffffff');
    }
  }
}

function drawTongue(r: Raster, p: Pfp) {
  // A tilted, asymmetric grin follows the three-quarter face.
  r.poly([[43, 77], [50, 83], [65, 88], [84, 92], [102, 88], [96, 98], [83, 105], [67, 104], [53, 97], [45, 88]], BLACK);
  r.poly([[47, 81], [54, 85], [53, 91], [50, 90]], '#fffdf0');
  r.poly([[91, 93], [97, 91], [94, 97], [91, 97]], '#fffdf0');
  r.line(55, 87, 66, 91, '#555362');
  const tongue = p.skin === 'obsidian' ? ['#418c36', '#76d93f', '#b2fc66', '#e5ffa8'] : ['#b64168', '#ef6f95', '#ff94ae', '#ffd0d4'];
  r.poly([[61, 91], [66, 88], [72, 90], [76, 95], [83, 95], [85, 99], [83, 109], [79, 114], [69, 114], [65, 111], [65, 102], [60, 96]], tongue[0]);
  r.poly([[62, 93], [66, 91], [71, 92], [75, 98], [78, 98], [81, 96], [83, 99], [81, 109], [77, 112], [70, 112], [67, 109], [67, 100]], tongue[1]);
  r.poly([[64, 93], [69, 92], [72, 95], [74, 102], [74, 110], [70, 110], [69, 100]], tongue[2]);
  r.line(70, 95, 72, 102, tongue[3], 2);
  r.line(78, 99, 77, 106, tongue[0]);
  r.line(81, 99, 80, 103, tongue[3]);
}

/** Eye sockets tilt and close with the expression; the far eye stays smaller. */
export function drawEyes(r: Raster, p: Pfp) {
  if (!['wink', 'sleepy', 'angry', 'wide', 'money', 'cross', 'spiral', 'happy'].includes(p.eyes)) {
    drawClassicEyes(r, p);
    return;
  }
  const c = palette(p.skin);
  for (const [i, [x,y,rx,ry]] of [[64,64,15,19],[94,73,12,16]].entries()) {
    if (p.eyes === 'happy' || (p.eyes === 'wink' && i === 1)) {
      r.line(x-rx+2,y+3,x-5,y-5,c[0],4);
      r.line(x-5,y-5,x+2,y-5,BLACK,3);
      r.line(x+2,y-5,x+rx-4,y+3,BLACK,3);
      r.line(x-rx+4,y+8,x+rx-5,y+8,c[4],2);
      continue;
    }
    const half = p.eyes === 'sleepy';
    r.ellipse(x,y,rx+1,half ? 9 : ry+1,c[0]);
    r.ellipse(x+1,y,rx,half ? 7 : ry,c[5]);
    r.ellipse(x-1,y,rx-3,half ? 6 : ry-2,BLACK);
    if (p.eyes === 'wide') {
      r.ellipse(x,y,rx-2,ry-2,'#fffdf0');
      r.ellipse(x+2,y+1,4,7,BLACK);
      r.rect(x+1,y-3,2,3,'#99cde2');
      r.line(x-9,y-ry-5,x+5,y-ry-6,c[0],2);
    } else if (half) {
      r.ellipse(x+2,y+2,4,5,'#d8c875');
      r.poly([[x-rx,y-9],[x+rx,y-9],[x+rx,y-1],[x,y-3],[x-rx,y-1]],c[2]);
      r.line(x-rx,y-1,x,y-3,BLACK,2);
      r.line(x,y-3,x+rx,y-1,BLACK,2);
      r.line(x-rx+3,y-6,x+rx-2,y-6,c[4]);
    } else if (p.eyes === 'angry') {
      r.ellipse(x,y+4,5,7,'#ff654b');
      r.rect(x-1,y+1,2,7,'#ffeab0');
      const a = i === 0 ? -1 : 1;
      r.poly([[x-rx-2,y-ry-2],[x+rx+2,y-ry-2],[x+rx+2,y+a*8-4],[x-rx-2,y-a*8-4]],c[3]);
      r.line(x-rx,y-a*8-4,x+rx,y+a*8-4,BLACK,3);
    } else if (p.eyes === 'money') {
      r.poly([[x+6,y-8],[x-5,y-8],[x-8,y-4],[x-5,y],[x+4,y+2],[x+5,y+6],[x-7,y+6],[x-7,y+9],[x+6,y+9],[x+9,y+4],[x+6,y-1],[x-4,y-3],[x-4,y-5],[x+6,y-5]],'#8eed64');
      r.line(x,y-12,x,y+12,'#dfff9c',2);
    } else if (p.eyes === 'cross') {
      r.line(x-7,y-8,x+6,y+7,'#ed7899',4);
      r.line(x+6,y-8,x-7,y+7,'#ed7899',4);
      r.line(x-6,y-8,x+6,y+5,'#ffbfd0');
    } else if (p.eyes === 'spiral') {
      r.poly([[x-8,y-10],[x+7,y-10],[x+10,y-6],[x+10,y+9],[x-9,y+9],[x-9,y-5],[x+4,y-5],[x+4,y+4],[x-4,y+4],[x-4,y+1],[x+1,y+1],[x+1,y-2],[x-6,y-2],[x-6,y+6],[x+7,y+6],[x+7,y-7],[x-8,y-7]],'#c6a2ff');
    } else {
      r.star(x-1,y,8,'#fff4a4');
      r.rect(x-8,y-10,3,2,'#ffffff');
    }
  }
}

export function drawMouth(r: Raster, p: Pfp) {
  const c = palette(p.skin);
  if (p.mouth === 'tongue') return drawTongue(r,p);
  if (p.mouth === 'smile' || p.mouth === 'smirk') {
    const smirk = p.mouth === 'smirk';
    r.poly(smirk ? [[51,90],[68,96],[83,94],[93,86],[89,96],[80,100],[65,99]] : [[46,84],[57,91],[75,96],[90,94],[96,89],[93,97],[80,101],[65,99],[53,94]],BLACK);
    r.line(65,102,78,105,c[4],2);
    if (smirk) { r.line(89,86,93,86,c[0],2); r.line(49,87,51,94,c[0],2); }
    else { r.line(46,82,43,87,c[0],2); r.line(95,86,98,92,c[0],2); }
    return;
  }
  if (p.mouth === 'open') {
    r.ellipse(77,97,11,14,c[0]);
    r.ellipse(77,96,9,12,BLACK);
    r.ellipse(79,103,5,3,'#dc6788');
    r.line(71,85,77,83,c[4],2);
    return;
  }
  if (p.mouth === 'bubblegum') {
    r.ellipse(75,97,10,6,BLACK);
    r.ellipse(83,105,18,18,'#a43d83');
    r.ellipse(81,103,16,16,'#eb70b7');
    r.ellipse(79,100,13,12,'#ff97d1');
    r.poly([[70,95],[74,91],[80,90],[80,93],[75,95],[72,100],[69,100]],'#ffe0ef');
    r.line(87,113,94,108,'#c65099',2);
    r.pixel(73,97,'#ffffff');
    return;
  }
  const clenched = p.mouth === 'grimace';
  r.poly(clenched ? [[51,87],[62,86],[89,93],[98,97],[94,105],[69,103],[54,97]] : [[44,79],[56,86],[76,92],[101,88],[96,100],[84,108],[69,108],[55,100],[47,90]], BLACK);
  if (p.mouth === 'fangs' || p.mouth === 'drool') {
    r.poly([[51,86],[62,90],[59,100]],'#fff9df');
    r.poly([[88,94],[97,91],[90,104]],'#fff9df');
    r.poly([[64,101],[75,99],[84,103],[82,106],[71,106]],'#ad4567');
    if (p.mouth === 'drool') {
      r.poly([[79,99],[86,100],[87,111],[83,118],[78,118],[76,115],[80,110]],'#438939');
      r.poly([[80,100],[84,102],[84,113],[81,116],[79,114],[82,109]],'#a4ee5c');
      r.line(82,102,82,108,'#edff9d');
      r.ellipse(90,121,3,4,'#80cd49');
    }
  } else {
    const gold = p.mouth === 'gold';
    r.poly(clenched ? [[55,89],[63,89],[87,96],[94,98],[92,102],[70,100],[57,95]] : [[50,85],[61,91],[77,96],[96,92],[92,99],[82,104],[70,104],[58,98]],gold ? '#efbe41' : '#fff9e5');
    r.line(61,96,82,102,gold ? '#a76528' : '#b7bbb8');
    for (const [x,y] of [[62,92],[71,95],[81,97],[89,96]]) r.line(x,y,x-1,y+6,gold ? '#a76528' : '#797b83');
    if (clenched) r.line(58,92,92,100,'#797b83');
    if (gold) { r.line(61,92,70,95,'#fff3af',2); r.star(88,97,4,'#fffdf0'); }
  }
}
