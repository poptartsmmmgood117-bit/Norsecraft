'use strict';
// Game loop, synthesized audio, menus and screens.

// ---------- audio ----------

const Snd = { ctx: null, muted: false, last: {} };

function audioCtx() {
  if (!Snd.ctx) {
    try { Snd.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { Snd.ctx = null; }
  }
  return Snd.ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.15, slide = 0, delay = 0) {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.15, freq = 1200, delay = 0) {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t0);
}

// Overrides the no-op hook declared in game.js.
sfx = function (name) {
  if (Snd.muted || !Snd.ctx) return;
  const now = performance.now();
  const gap = { chop: 120, die: 80, thud: 100, select: 120, ack: 120 }[name] || 60;
  if (Snd.last[name] && now - Snd.last[name] < gap) return;
  Snd.last[name] = now;
  switch (name) {
    case 'chop': noise(0.06, 0.06, 2500); break;
    case 'select': tone(520, 0.06, 'triangle', 0.06); break;
    case 'ack': tone(392, 0.07, 'triangle', 0.07); tone(523, 0.07, 'triangle', 0.06, 0, 0.06); break;
    case 'click': tone(660, 0.05, 'square', 0.04); break;
    case 'error': tone(160, 0.15, 'square', 0.06); break;
    case 'place': noise(0.15, 0.12, 600); tone(220, 0.12, 'triangle', 0.08); break;
    case 'ready': tone(440, 0.12, 'triangle', 0.08); tone(587, 0.18, 'triangle', 0.08, 0, 0.1); break;
    case 'done': tone(196, 0.4, 'sawtooth', 0.06); tone(294, 0.5, 'sawtooth', 0.05, 0, 0.18); break;
    case 'alarm': tone(110, 0.7, 'sawtooth', 0.09, 20); tone(110, 0.8, 'sawtooth', 0.08, 20, 0.8); break;
    case 'die': noise(0.2, 0.08, 900); break;
    case 'crash': noise(0.9, 0.2, 500); break;
    case 'thud': noise(0.25, 0.14, 300); break;
    case 'victory': [262, 330, 392, 523].forEach((f, i) => tone(f, 0.5, 'triangle', 0.1, 0, i * 0.18)); break;
    case 'defeat': [220, 196, 165, 131].forEach((f, i) => tone(f, 0.6, 'sawtooth', 0.06, 0, i * 0.25)); break;
  }
};

// ---------- screens ----------

const Setup = { faction: 'vikings', difficulty: 'normal', speed: 1 };

function initTitle() {
  document.querySelectorAll('[data-faction]').forEach(b => b.addEventListener('click', () => {
    Setup.faction = b.dataset.faction;
    document.querySelectorAll('[data-faction]').forEach(x => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => {
    Setup.difficulty = b.dataset.diff;
    document.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
    Setup.speed = +b.dataset.speed;
    document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b));
  }));
  $('start').addEventListener('click', () => { audioCtx(); startGame(); });
  $('help-btn').addEventListener('click', toggleHelp);
  $('help-close').addEventListener('click', toggleHelp);
  $('menu-btn').addEventListener('click', togglePause);
  $('resume').addEventListener('click', togglePause);
  $('restart').addEventListener('click', () => { $('pause').style.display = 'none'; G.paused = false; startGame(); });
  $('quit').addEventListener('click', toTitle);
  $('again').addEventListener('click', () => { $('end').style.display = 'none'; startGame(); });
  $('to-title').addEventListener('click', toTitle);
  $('mute').addEventListener('click', () => {
    Snd.muted = !Snd.muted;
    $('mute').textContent = Snd.muted ? '🔇' : '🔊';
  });
  $('speed-sel').addEventListener('change', e => { G.speed = +e.target.value; });

  // Faction preview portraits.
  for (const f of ['vikings', 'jotnar']) {
    const box = $('pv-' + f);
    for (const t of ['worker', 'melee', 'ranged', 'rider', 'siege']) {
      const c = document.createElement('canvas');
      c.width = 46; c.height = 46;
      box.appendChild(c);
      drawIcon(c, 'unit', t, f, FACTIONS[f].color);
    }
  }
}

function toTitle() {
  $('pause').style.display = 'none';
  $('end').style.display = 'none';
  $('title').style.display = 'flex';
  G.paused = true;
}

function startGame() {
  newGame({ faction: Setup.faction, difficulty: Setup.difficulty, speed: Setup.speed });
  G.over = null;
  buildTerrain();
  UI.selected.clear();
  UI.groups = {};
  UI.placing = null;
  UI.targeting = null;
  UI.menu = 'main';
  UI.sig = '';
  G.endShown = false;
  $('speed-sel').value = String(Setup.speed);
  $('title').style.display = 'none';
  $('end').style.display = 'none';
  resize();
  const hall = G.ents.find(e => e.type === 'hall' && e.owner === G.human);
  centerOn(hall.x, hall.y);
  const p = humanPlayer();
  const foe = G.players[1];
  msg(`The ${FACTIONS[foe.faction].short} gather beyond the fjord. Build up and destroy them!`);
  msg(`Right-click the gold mine with your ${unitName('worker', p.faction)}s to start mining.`);
}

function toggleHelp() {
  const h = $('help');
  h.style.display = h.style.display === 'flex' ? 'none' : 'flex';
}

function togglePause() {
  if (!G.map || G.over || $('title').style.display !== 'none') return;
  G.paused = !G.paused;
  $('pause').style.display = G.paused ? 'flex' : 'none';
}

function showEnd() {
  G.endShown = true;
  const win = G.over === 'victory';
  const p = humanPlayer();
  const foe = G.players[1];
  $('end-title').textContent = win ? 'Victory' : 'Defeat';
  $('end-text').textContent = win
    ? `The ${FACTIONS[foe.faction].short} are broken. Skalds will sing of this day.`
    : `Your halls burn. The ${FACTIONS[foe.faction].short} have claimed this land.`;
  const t = Math.floor(G.time);
  $('end-stats').innerHTML = `
    <tr><th></th><th>You</th><th>${FACTIONS[foe.faction].short}</th></tr>
    <tr><td>Gold mined</td><td>${p.stats.gold}</td><td>${foe.stats.gold}</td></tr>
    <tr><td>Lumber cut</td><td>${p.stats.wood}</td><td>${foe.stats.wood}</td></tr>
    <tr><td>Kills</td><td>${p.stats.killed}</td><td>${foe.stats.killed}</td></tr>
    <tr><td>Losses</td><td>${p.stats.lost}</td><td>${foe.stats.lost}</td></tr>
    <tr><td>Time</td><td colspan="2">${Math.floor(t / 60)}m ${t % 60}s</td></tr>`;
  $('end').classList.toggle('win', win);
  $('end').style.display = 'flex';
}

// ---------- loop ----------

function resize() {
  const view = $('view');
  const wrap = $('viewwrap');
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  UI.vw = Math.floor(r.width);
  UI.vh = Math.floor(r.height);
  view.width = Math.floor(UI.vw * dpr);
  view.height = Math.floor(UI.vh * dpr);
  view.style.width = UI.vw + 'px';
  view.style.height = UI.vh + 'px';
  UI.dpr = dpr;
  if (G.map) clampCam();
}

let lastT = 0, acc = 0, miniT = 0;
const STEP = 1 / 30;

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastT) / 1000 || 0);
  lastT = t;
  if (!G.map || $('title').style.display !== 'none') return;
  if (!G.paused && !G.over) {
    acc += dt * G.speed;
    let n = 0;
    while (acc >= STEP && n < 8) { tick(STEP); acc -= STEP; n++; }
    if (n >= 8) acc = 0;
  }
  if (G.over && !G.endShown) setTimeout(showEnd, 1200), G.endShown = true;
  scrollCamera(dt);
  if (UI.mouseWorld) UI.mouseWorld = toWorld(UI.mouse.x, UI.mouse.y);
  UI.hover = UI.mouse.in && UI.mouseWorld ? entityAt(UI.mouseWorld.x, UI.mouseWorld.y) : null;
  const view = $('view');
  const ctx = view.getContext('2d');
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  render(ctx, UI.cam, UI.vw, UI.vh, UI);
  miniT -= dt;
  if (miniT <= 0) {
    miniT = 0.15;
    drawMinimap($('minimap').getContext('2d'), UI.cam, UI.vw, UI.vh);
  }
  rebuildPanels();
  updateLive();
}

window.addEventListener('resize', resize);
window.addEventListener('load', () => {
  initTitle();
  initInput();
  resize();
  requestAnimationFrame(frame);
  // Debug hooks: ?autostart, ?reveal, ?ai (computer plays both sides).
  const q = new URLSearchParams(location.search);
  if (q.has('autostart') || q.has('ai')) {
    if (q.get('faction')) Setup.faction = q.get('faction');
    startGame();
    if (q.has('reveal')) G.revealAll = true;
    if (q.has('ai')) G.ai2 = new AI(0, q.get('ai') || 'normal');
    if (q.get('speed')) G.speed = +q.get('speed');
  }
});
