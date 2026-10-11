(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------------- starfield ---------------- */
  function starfield() {
    const c = $('#stars');
    const ctx = c.getContext('2d');
    let w = 0, h = 0, stars = [];
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let shoot = null, nextShoot = performance.now() + 3000;

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 2300);
      stars = Array.from({ length: n }, () => {
        const big = Math.random() < 0.07;
        return {
          x: Math.random() * w, y: Math.random() * h, z: Math.random(),
          r: big ? 1.1 + Math.random() * 0.9 : 0.3 + Math.random() * 0.7,
          ph: Math.random() * Math.PI * 2, sp: 0.4 + Math.random() * 1.6,
        };
      });
    }

    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
      const sy = scrollY;
      ctx.fillStyle = '#fff';
      for (const s of stars) {
        const depth = 0.12 + s.z * 0.88;
        let x = (s.x - mx * 18 * depth) % w; if (x < 0) x += w;
        let y = (s.y - sy * 0.12 * depth - my * 18 * depth) % h; if (y < 0) y += h;
        const tw = reduce ? 0.8 : 0.35 + 0.65 * Math.sin(t * 0.001 * s.sp + s.ph) ** 2;
        ctx.globalAlpha = tw * (0.3 + 0.7 * s.z);
        if (s.r < 0.8) ctx.fillRect(x, y, s.r * 1.6, s.r * 1.6);
        else { ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill(); }
      }
      if (!reduce) {
        if (!shoot && t > nextShoot) {
          const a = 0.5 + Math.random() * 0.35;
          shoot = { x: w * (0.2 + Math.random() * 0.9), y: h * Math.random() * 0.4, vx: -Math.cos(a) * 900, vy: Math.sin(a) * 900, born: t, life: 700 + Math.random() * 400 };
        }
        if (shoot) {
          const k = (t - shoot.born) / shoot.life;
          if (k >= 1) { shoot = null; nextShoot = t + 5000 + Math.random() * 7000; }
          else {
            const x = shoot.x + shoot.vx * k * shoot.life / 1000, y = shoot.y + shoot.vy * k * shoot.life / 1000;
            const tail = 0.14;
            const g = ctx.createLinearGradient(x, y, x - shoot.vx * tail, y - shoot.vy * tail);
            g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalAlpha = Math.sin(k * Math.PI);
            ctx.strokeStyle = g; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - shoot.vx * tail, y - shoot.vy * tail); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) requestAnimationFrame(frame);
    }

    addEventListener('pointermove', (e) => { tmx = e.clientX / w - 0.5; tmy = e.clientY / h - 0.5; }, { passive: true });
    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
    if (reduce) addEventListener('scroll', () => requestAnimationFrame(frame), { passive: true });
  }

  /* ---------------- the moon (WebGL, procedural) ---------------- */
  const MOON_VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const MOON_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uC;      // sphere centre, device px, origin bottom-left
uniform float uR;     // sphere radius, device px
uniform float uA;     // rotation angle
uniform float uDpr;

float h1(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec3 h3(vec3 p){ return vec3(h1(p), h1(p+vec3(31.7,17.3,5.1)), h1(p+vec3(11.9,63.1,27.7))); }

float vn(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h1(i),h1(i+vec3(1,0,0)),f.x), mix(h1(i+vec3(0,1,0)),h1(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h1(i+vec3(0,0,1)),h1(i+vec3(1,0,1)),f.x), mix(h1(i+vec3(0,1,1)),h1(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vn(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s; }

// one octave of craters: bowl + raised rim, summed height h and slope g
void crat(vec3 p, float F, float dens, float k, inout float h, inout vec3 g){
  vec3 q = p*F;
  vec3 ci = floor(q);
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
    vec3 c = ci + vec3(float(x),float(y),float(z));
    if(h1(c + 91.7) > dens) continue;
    float rs = h1(c + 47.3);
    float r = mix(0.16, 0.52, rs*rs);
    vec3 d = q - (c + h3(c));
    float dist = length(d);
    float t = dist / r;
    if(t > 1.8) continue;
    float bowl = t < 1.0 ? t*t - 1.0 : 0.0;
    float dbowl = t < 1.0 ? 2.0*t : 0.0;
    float e = (t - 1.0) / 0.2;
    float rim = 0.42*exp(-e*e);
    float drim = rim * (-2.0*e/0.2);
    float fade = smoothstep(1.8, 1.3, t);
    h += (k*r/F) * (bowl + rim) * fade;
    g += k * (dbowl + drim) * fade * d / max(dist, 1e-4);
  }
}

void main(){
  vec2 d = (gl_FragCoord.xy - uC) / uR;
  float rr = length(d);
  float edgePx = (rr - 1.0) * uR;                 // >0 outside the disc
  vec3 L = normalize(vec3(-0.6, 0.66, 0.45));
  vec2 dir = d / max(rr, 1e-4);
  float side = 0.3 + 0.7*max(dot(dir, normalize(L.xy)), 0.0);

  // halo outside the limb
  float o = max(edgePx, 0.0) / uDpr;
  float glow = (exp(-o/26.0)*0.55 + exp(-o/140.0)*0.16) * side;

  float cov = clamp(0.5 - edgePx, 0.0, 1.0);
  if(cov <= 0.0){ gl_FragColor = vec4(vec3(glow), glow); return; }

  float z = sqrt(max(1.0 - rr*rr, 0.0));
  vec3 n = vec3(d, z);
  float ca = cos(uA), sa = sin(uA);
  vec3 p = vec3(n.x, ca*n.y - sa*n.z, sa*n.y + ca*n.z);   // roll toward the viewer

  float h = 0.0; vec3 g = vec3(0.0);
  crat(p, 3.2, 0.5, 0.55, h, g);
  crat(p, 8.5, 0.6, 0.55, h, g);
  crat(p, 22.0, 0.72, 0.5, h, g);
  crat(p, 55.0, 0.8, 0.42, h, g);

  float m = fbm(p*2.1 + 4.0);
  float maria = smoothstep(0.5, 0.64, m);
  float grain = fbm(p*46.0);
  float alb = mix(0.8, 0.46, maria) * (0.82 + 0.34*grain);
  alb *= 1.0 + clamp(h*60.0, -0.25, 0.1);        // crater floors a touch darker

  vec3 gt = g - dot(g, p)*p;
  vec3 nbo = normalize(p - gt*mix(1.0, 0.55, maria));
  vec3 nb = vec3(nbo.x, ca*nbo.y + sa*nbo.z, -sa*nbo.y + ca*nbo.z);

  float mu0 = max(dot(nb, L), 0.0);
  float mu = max(nb.z, 0.0);
  float ls = 2.0*mu0/(mu0 + mu + 0.08);          // Lommel-Seeliger: the flat lunar look
  float shade = mix(ls*0.55, mu0*1.25, 0.55);
  float col = alb*shade + 0.018;
  col += pow(1.0 - z, 5.0) * 0.35 * side;         // bright limb
  col = col / (1.0 + col*0.35);                   // soft shoulder
  col += (h1(vec3(gl_FragCoord.xy, 3.0)) - 0.5) / 255.0;

  vec3 c = vec3(col) * vec3(1.0, 0.995, 0.985);
  gl_FragColor = vec4(c*cov + vec3(glow)*(1.0 - cov), cov + glow*(1.0 - cov));
}`;

  function moon() {
    const canvas = $('#moon');
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
    if (!gl) { document.documentElement.classList.add('no-webgl'); return null; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, MOON_VS), fs = sh(gl.FRAGMENT_SHADER, MOON_FS);
    const prog = gl.createProgram();
    if (!vs || !fs) { document.documentElement.classList.add('no-webgl'); return null; }
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); document.documentElement.classList.add('no-webgl'); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n) => gl.getUniformLocation(prog, n);
    const uC = u('uC'), uR = u('uR'), uA = u('uA'), uDpr = u('uDpr');

    let dpr = 1, visible = true, angle = 0.6, last = performance.now(), boost = 0, lastScroll = scrollY, acc = 0;

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.25 : 1.5);
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const R = Math.max(r.width * 1.12, 820);
      const top = r.height * 0.3;                       // arc peak, px from canvas top
      gl.uniform2f(uC, canvas.width / 2, (r.height - top - R) * dpr);
      gl.uniform1f(uR, R * dpr);
      gl.uniform1f(uDpr, dpr);
      draw();
    }
    function draw() { gl.uniform1f(uA, angle); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    function loop(t) {
      const dt = Math.min((t - last) / 1000, 0.1); last = t;
      const s = scrollY; boost += Math.abs(s - lastScroll) * 0.00005; lastScroll = s; boost *= 0.94;
      angle += dt * 0.009 + boost * 0.4;
      acc += dt;
      if (visible && acc >= 1 / 30) { acc = 0; draw(); }   // 30 fps is plenty for a slow roll
      requestAnimationFrame(loop);
    }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    addEventListener('resize', resize);
    resize();
    if (!reduce) requestAnimationFrame(loop);
    return { resize };
  }

  /* ---------------- hero parallax + tilt ---------------- */
  function hero() {
    const stage = $('.hero-stage'), moonWrap = $('.moon-wrap'), img = $('.mooner'), nav = $('.nav');
    const onScroll = () => {
      const y = scrollY;
      nav.classList.toggle('scrolled', y > 12);
      if (reduce || y > innerHeight * 1.3) return;
      stage.style.transform = `translate3d(0, ${y * -0.16}px, 0)`;
      moonWrap.style.transform = `translate3d(0, ${y * 0.3}px, 0)`;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (!reduce && matchMedia('(pointer: fine)').matches) {
      addEventListener('pointermove', (e) => {
        const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
        img.style.setProperty('--ry', `${x * 16}deg`);
        img.style.setProperty('--rx', `${y * -10}deg`);
      }, { passive: true });
    }
  }

  /* ---------------- reveal on scroll ---------------- */
  function reveals() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('.reveal').forEach((el) => io.observe(el));
  }

  /* ---------------- card glow ---------------- */
  function cards() {
    $$('.card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  }

  /* the one-hour card: its clock follows the ring (8 s = one hour) */
  function hourClock() {
    const span = $('.viz-clock span');
    if (!span || reduce) return;
    const ring = $('.viz-clock .ring-fg');
    const t0 = performance.now();
    const tick = () => {
      // follow the ring's own CSS animation so the digits match the arc
      const anim = ring && ring.getAnimations && ring.getAnimations()[0];
      const t = anim && anim.currentTime != null ? anim.currentTime : performance.now() - t0;
      const left = Math.round(3600 * (1 - (t % 8000) / 8000));
      span.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    };
    let id = 0;
    new IntersectionObserver(([e]) => {
      clearInterval(id);
      if (e.isIntersecting) id = setInterval(tick, 250);
    }).observe(span);
  }

  /* ---------------- presale simulation ---------------- */
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const wallet = () => { let a = ''; for (let i = 0; i < 8; i++) a += (i === 4 ? '…' : '') + B58[(Math.random() * 58) | 0]; return a; };
  // 48 Mooner PFPs from the app's renderer, one 8 x 6 sheet (assets/mooner-pfps.webp)
  const PFP_COLS = 8, PFP_ROWS = 6;
  let deck = [];
  function pfp(node) {
    if (!deck.length) {                                       // shuffled, so a round never repeats a face
      deck = [...Array(PFP_COLS * PFP_ROWS).keys()];
      for (let i = deck.length - 1; i > 0; i--) { const k = (Math.random() * (i + 1)) | 0; [deck[i], deck[k]] = [deck[k], deck[i]]; }
    }
    const n = deck.pop();
    node.style.setProperty('--x', n % PFP_COLS);
    node.style.setProperty('--y', Math.floor(n / PFP_COLS));
  }

  function presale() {
    const el = $('.presale'); if (!el) return;
    const seatsEl = $('.ps-seats', el), bar = $('.ps-bar i', el), poolEl = $('.ps-pool', el), countEl = $('.ps-count', el);
    const feed = $('.ps-feed', el), clock = $('.ps-clock', el), phase = $('.ps-phase', el), holders = $('.ps-holders', el);
    // hundredths of a SOL: the real 10 SOL pot, 0.1-1 SOL seats (the chain runs 0.5 SOL for testing)
    const TARGET = 1000, MIN = 10, MAX = 100, OPEN = 50;       // OPEN: the creator's seat, leaving room for others
    const PICKS = [10, 20, 25, 25, 50, 50, 50, 75, 100, 100];
    let seats = [], pool = 0, secs = 3600, timer = 0, wake = null, visible = false, busy = false;

    const sol = (c) => (c / 100).toFixed(2);
    const wait = (ms) => new Promise((r) => { wake = r; timer = setTimeout(r, ms); });

    function render() {
      bar.style.setProperty('--p', `${(pool / TARGET) * 100}%`);
      poolEl.textContent = `${sol(pool)} / ${TARGET / 100} SOL`;
      countEl.textContent = `${seats.length} in`;
      clock.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }
    function log(who, what, tag) {
      const li = document.createElement('li');
      li.innerHTML = `<span><b>${who}</b> ${what}</span><em>${tag}</em>`;
      feed.prepend(li);
      while (feed.children.length > 3) feed.lastElementChild.remove();
    }
    function addSeat(amount, creator) {
      const node = document.createElement('span');
      node.className = `seat${creator ? ' creator' : ''}`;
      pfp(node);
      const seat = { amount, node, creator, name: creator ? 'creator' : wallet() };
      seatsEl.append(node); seats.push(seat);
      return seat;
    }
    function join(fixed) {
      const room = TARGET - pool;
      let amt = fixed ?? (Math.random() < 0.65 ? PICKS[(Math.random() * PICKS.length) | 0] : MIN + ((Math.random() * (MAX - MIN + 1)) | 0));
      amt = room < MIN ? room : Math.min(amt, room, MAX);
      if (room - amt > 0 && room - amt < MIN) amt = room;     // never leave less than a seat's minimum
      const s = addSeat(amt, false); pool += amt;
      log(s.name, 'joined', `+${sol(amt)} SOL`);
    }
    function change() {
      const pick = seats.filter((s) => !s.creator);
      if (!pick.length) return join();
      const s = pick[(Math.random() * pick.length) | 0];
      const hi = Math.min(MAX, TARGET - pool + s.amount);
      const next = MIN + (((Math.random() * (hi - MIN + 1)) | 0));
      const left = TARGET - (pool - s.amount + next);
      if (next === s.amount || (left > 0 && left < MIN)) return join();
      pool += next - s.amount; s.amount = next;
      log(s.name, `changed to ${sol(next)}`, 'free');
    }
    function withdraw() {
      const pick = seats.filter((s) => !s.creator);
      if (pick.length < 2) return join();
      const s = pick[(Math.random() * pick.length) | 0];
      pool -= s.amount; seats = seats.filter((x) => x !== s);
      s.node.classList.add('out'); setTimeout(() => s.node.remove(), 400);
      log(s.name, 'pulled out', 'free');
    }

    async function run() {
      if (busy) return; busy = true;
      while (visible) {
        seats = []; pool = 0; secs = 3600; deck = [];
        seatsEl.innerHTML = ''; feed.innerHTML = '';
        el.classList.remove('is-full', 'is-live');
        phase.textContent = 'presale · filling up';
        const c = addSeat(OPEN, true); pool += OPEN;
        log(c.name, 'opened the presale', `+${sol(OPEN)} SOL`);
        render();
        while (pool < TARGET && visible) {
          await wait(260 + Math.random() * 320);           // about 20 s to fill 10 SOL
          const r = Math.random();
          if (r < 0.55 || pool > TARGET - MIN) join(); else if (r < 0.8) change(); else withdraw();
          secs = Math.max(60, secs - (15 + ((Math.random() * 40) | 0)));
          render();
        }
        if (!visible) break;
        el.classList.add('is-full');
        phase.textContent = 'pot full · launching';
        log('pot', `hit ${TARGET / 100} SOL`, 'locked');
        await wait(1200);
        phase.textContent = 'sending coins…';
        await wait(1100);
        holders.textContent = seats.length;
        phase.textContent = 'live · trading';
        el.classList.add('is-live');
        log(`${seats.length} holders`, 'got the same price', 'launched');
        await wait(4600);
      }
      busy = false;
    }

    if (reduce) {                                    // a still frame instead of the loop
      const c = addSeat(OPEN, true); pool = OPEN;
      log(c.name, 'opened the presale', `+${sol(OPEN)} SOL`);
      for (const amt of [100, 50, 25, 75, 100, 50, 20]) join(amt); // 4.70 of 10 SOL, the same every time
      secs = 2291; render();
      return;
    }
    new IntersectionObserver(([e], io) => {                // fetch the PFP sheet a little before it's needed
      if (e.isIntersecting) { new Image().src = 'assets/mooner-pfps.webp'; io.disconnect(); }
    }, { rootMargin: '600px 0px' }).observe(el);
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) run(); else { clearTimeout(timer); wake?.(); } // resolve, so run() can exit and start again
    }, { threshold: 0.2 }).observe(el);
  }

  /* ---------------- waitlist ---------------- */
  // Joining is a sign-up: Privy checks the email (a code) and the X account (X login) and makes a
  // wallet, then /api/join puts the person on the list with their NFTs. That code is large, so
  // assets/join/join.js loads on the first join click, or when X sends the person back here.
  function waitlist() {
    const forms = $$('form.waitlist');
    const q = new URLSearchParams(location.search);
    const ref = q.get('r');
    const endpoint = forms[0]?.dataset.endpoint || window.MOONER_WAITLIST_ENDPOINT || '';
    const notes = new Map(forms.map((f) => [f, $('.wl-msg', f).textContent])); // each note, as the page has it
    let running = false; // one run at a time, across both forms and the X resume
    // X can come back from the back/forward cache with the form stuck on "joining…": load it fresh
    addEventListener('pageshow', (e) => { if (e.persisted && running) location.reload(); });
    const say = (f, text, err = false) => { const m = $('.wl-msg', f); m.className = err ? 'wl-msg err' : 'wl-msg'; m.textContent = text; };
    const reserved = (n) => `${n} NFT${n === 1 ? '' : 's'} reserved`;
    const done = (r) => forms.forEach((g) => {
      g.classList.add('done');
      if (r.email) $('input', g).value = r.email;
      $('input', g).disabled = true; $('button', g).disabled = true;
      $('button span', g).textContent = "you're in";
      say(g, r.already ? `you're already in. ${reserved(r.nfts)}`
        : `you're on the waitlist. ${reserved(r.nfts)}${r.early ? ', thanks for being early' : ''}${r.emailed ? '. check your email' : ''}`);
    });
    async function go(f, start) {
      if (running) return;
      running = true;
      const idle = new Map(forms.map((g) => [g, $('button span', g).innerHTML])); // keeps the " waitlist" part that small phones hide
      const reset = () => forms.forEach((g) => { $('button', g).disabled = false; $('button span', g).innerHTML = idle.get(g); });
      forms.forEach((g) => { $('button', g).disabled = true; });
      $('button span', f).textContent = 'joining…'; f.classList.add('busy');
      try {
        let signup;
        try {
          signup = await import('./assets/join/join.js');
        } catch (err) { // the browser may keep a failed module load for the life of the page, so retrying here can't work
          console.warn('waitlist', err);
          say(f, 'couldn’t load. reload the page?', true);
          reset();
          return;
        }
        done(await start(signup, (step) => say(f, step)));
      } catch (err) {
        console.warn('waitlist', err);
        say(f, err.shown || 'that didn’t go through. try again?', true);
        reset();
      } finally {
        running = false;
        f.classList.remove('busy');
      }
    }
    // typing again clears a refusal: the red ring, and the note comes back
    forms.forEach((f) => $('input', f).addEventListener('input', (e) => {
      if (!e.target.hasAttribute('aria-invalid')) return;
      e.target.removeAttribute('aria-invalid');
      say(f, notes.get(f));
    }));
    forms.forEach((f) => f.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('input', f), email = input.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        say(f, 'enter your email', true);
        input.setAttribute('aria-invalid', 'true'); input.focus();
        f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); // restart the shake
        return;
      }
      input.removeAttribute('aria-invalid');
      if (!endpoint) return say(f, 'preview: no waitlist endpoint set, nothing was saved');
      go(f, (signup, onStep) => signup.join({ email, ref, endpoint, onStep }));
    }));
    // X sends the person back with Privy's privy_oauth_* params: finish where the sign-up stopped
    if (endpoint && forms[0] && q.has('privy_oauth_state')) go(forms[0], (signup, onStep) => signup.resume({ ref, endpoint, onStep }));
  }

  starfield();
  moon();
  hero();
  reveals();
  cards();
  hourClock();
  presale();
  waitlist();
})();
