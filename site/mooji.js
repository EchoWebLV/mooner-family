// Moojis: standard emoji in the page's text become Mooner faces (assets/mooji/*.svg,
// made by tools/make-moojis.py). The emoji stays as the image's alt text.
(() => {
  // file -> [tooltip, emoji it replaces]
  const SET = {
    smile: ['gm', '🙂☺😊'],
    grin: ['wagmi', '😀😃😄😁'],
    lol: ['lmao', '😆😂🤣'],
    sob: ['sold the bottom', '😭'],
    tear: ["it's fine", '🥲'],
    sad: ['down bad', '😢😥😞😔☹🙁'],
    sweat: ['close one', '😅😓'],
    shades: ['deal with it', '😎'],
    money: ['wen lambo', '🤑'],
    hearts: ['in love with the chart', '😍🥰😻'],
    starstruck: ['100x', '🤩'],
    diamond: ['diamond hands', '💎'],
    wink: ['ser', '😉'],
    tongue: ['nfa', '😛'],
    zany: ['full port', '😜😝🤪'],
    smirk: ['i told you', '😏'],
    meh: ['bearish', '😐😑😶😒'],
    scream: ['who sold', '😱😨😰🙀'],
    mad: ['who sold', '😡😠🤬😤'],
    evil: ['laser eyes', '😈👿'],
    dead: ['rekt', '💀☠😵'],
    clown: ['bought the top', '🤡'],
    mindblown: ['just read the whitepaper', '🤯'],
    sleep: ['waiting for the pump', '😴😪🥱'],
    pls: ['pls pump', '🥺'],
    drool: ['wen airdrop', '🤤'],
    angel: ['i would never rug', '😇'],
    upside: ['rugged', '🙃'],
    shifty: ['watching the chart', '👀'],
    hmm: ['dyor', '🤔🧐'],
    grimace: ["it's fine", '😬'],
    rocket: ['lfg', '🚀'],
    fire: ["it's pumping", '🔥'],
    pump: ['number go up', '📈'],
    dump: ['number go down', '📉'],
    moon: ['gm', '🌝🌚'],
  };

  const BY = new Map();
  for (const [file, [label, list]] of Object.entries(SET)) for (const e of list) BY.set(e, [file, label]);
  // each with an optional variation selector (☺ with or without U+FE0F); never half of a
  // ZWJ sequence like heart-on-fire (❤ ZWJ 🔥), which would leave the other half behind
  const SRC = `(?<!\\u200D)(?:${[...BY.keys()].join('|')})\\uFE0F?(?!\\u200D)`;
  const RE = new RegExp(SRC, 'gu');
  const HAS = new RegExp(SRC, 'u'); // no g: test() must not carry lastIndex from one string to the next
  const SKIP = 'script, style, textarea, code, pre, noscript, option, title, [data-no-mooji]';
  const HTML = 'http://www.w3.org/1999/xhtml';

  function img(emoji) {
    const [file, label] = BY.get(emoji.replace('\uFE0F', ''));
    const el = document.createElement('img');
    el.className = 'mooji';
    el.src = `assets/mooji/${file}.svg`;
    el.alt = emoji;
    el.title = label;
    el.draggable = false;
    return el;
  }

  function swap(text) {
    const s = text.nodeValue;
    if (!HAS.test(s)) return;
    const out = document.createDocumentFragment();
    let at = 0;
    for (const m of s.matchAll(RE)) {
      if (m.index > at) out.append(s.slice(at, m.index));
      out.append(img(m[0]));
      at = m.index + m[0].length;
    }
    if (at < s.length) out.append(s.slice(at));
    text.replaceWith(out);
  }

  const skip = (el) => !el || el.namespaceURI !== HTML || el.isContentEditable || !!el.closest(SKIP);

  function moojify(root = document.body) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (!skip(root.parentElement)) swap(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || skip(root)) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (HAS.test(n.nodeValue) && !skip(n.parentElement)) found.push(n);
    found.forEach(swap);
  }

  window.moojify = moojify;
  moojify();
  // text added later (the presale feed, form messages) gets the same treatment
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') moojify(r.target);
      else r.addedNodes.forEach((n) => moojify(n));
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
})();
