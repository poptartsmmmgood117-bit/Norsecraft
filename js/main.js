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
    case 'select': if (!speak('select')) tone(520, 0.06, 'triangle', 0.06); break;
    case 'ack': if (!speak('ack')) { tone(392, 0.07, 'triangle', 0.07); tone(523, 0.07, 'triangle', 0.06, 0, 0.06); } break;
    case 'heal': [660, 880, 1100].forEach((f, i) => tone(f, 0.25, 'sine', 0.05, 0, i * 0.07)); break;
    case 'summon': tone(140, 0.9, 'sawtooth', 0.05, 220); noise(0.6, 0.06, 1800); break;
    case 'thunder': noise(1.4, 0.25, 260); tone(55, 1.2, 'sawtooth', 0.06, -20); break;
    case 'zap': noise(0.12, 0.12, 4000); break;
    case 'wind': noise(2.5, 0.12, 900); noise(2.5, 0.06, 2600, 0.4); break;
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

// ---------- unit voices ----------

// A tiny formant synthesizer: a buzzing source through two vowel filters
// gives each unit a short grunt of acknowledgement.
const VOWELS = [[730, 1090], [570, 840], [400, 1900], [300, 870], [660, 1700]];
const VOICE = {
  vikings: { worker: 150, melee: 115, ranged: 135, rider: 240, siege: 0, caster: 250, einherjar: 95, wolf: -1 },
  jotnar: { worker: 120, melee: 75, ranged: 100, rider: -1, siege: 55, caster: 90, einherjar: 95, wolf: -1 },
};

function syllable(ac, out, f0, t0, dur, vowel, glide) {
  const src = ac.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0, t0);
  src.frequency.linearRampToValueAtTime(f0 * glide, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g);
  for (const [i, f] of vowel.entries()) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 9;
    const fg = ac.createGain();
    fg.gain.value = i === 0 ? 0.9 : 0.5;
    g.connect(bp).connect(fg).connect(out);
  }
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function speak(kind) {
  const ac = Snd.ctx;
  const u = [...UI.selected].find(e => e.kind === 'unit' && e.owner === G.human && !e.dead);
  if (!ac || !u) return false;
  const f = G.players[u.owner].faction;
  const f0 = VOICE[f][u.type];
  const t0 = ac.currentTime + 0.01;
  const out = ac.createGain();
  out.gain.value = 0.22;
  out.connect(ac.destination);
  if (f0 === -1) {
    // Wolves and wolf riders: a short growl or yip.
    tone(kind === 'ack' ? 420 : 180, kind === 'ack' ? 0.35 : 0.3, 'sawtooth', 0.05, kind === 'ack' ? 260 : -60);
    return true;
  }
  if (f0 === 0) {
    // The ballista creaks instead of talking.
    noise(0.18, 0.1, 700);
    tone(90, 0.15, 'square', 0.03, 40, 0.12);
    return true;
  }
  const jit = 0.9 + Math.random() * 0.2;
  const v1 = VOWELS[Math.floor(Math.random() * VOWELS.length)];
  if (kind === 'select') {
    syllable(ac, out, f0 * jit, t0, 0.22, v1, 1.15);
  } else {
    syllable(ac, out, f0 * jit * 1.1, t0, 0.12, VOWELS[2], 1.0);
    syllable(ac, out, f0 * jit, t0 + 0.13, 0.2, v1, 0.85);
  }
  if (u.type === 'einherjar') noise(0.4, 0.04, 3000);
  return true;
}

// ---------- music ----------

// Generative Norse-flavoured score: a drone on D, a frame drum and a sparse
// lyre-like melody in D dorian. Drums grow busier while battle is near.
const Music = { on: true, timer: null, next: 0, step: 0, out: null, phrase: [] };
const MUSIC_STEP = 60 / 76 / 2;
const BASS = [73.42, 73.42, 65.41, 55.0];
const SCALE = [293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33];

function makePhrase() {
  const ph = [];
  let deg = 4;
  for (let i = 0; i < 64; i++) {
    if (i % 2 === 0 && Math.random() < 0.38) {
      deg = Math.max(0, Math.min(SCALE.length - 1, deg + Math.floor(Math.random() * 5) - 2));
      ph.push(deg);
    } else ph.push(-1);
  }
  return ph;
}

function musicVoice(ac, freq, t0, dur, vol) {
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const vib = ac.createOscillator();
  vib.frequency.value = 5;
  const vg = ac.createGain();
  vg.gain.value = freq * 0.008;
  vib.connect(vg).connect(o.frequency);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(Music.out);
  o.start(t0); vib.start(t0);
  o.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
}

function musicDrone(ac, freq, t0, dur) {
  for (const [mult, det] of [[1, -4], [1.5, 3], [2, 0]]) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq * mult;
    o.detune.value = det;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(mult === 2 ? 0.012 : 0.025, t0 + 0.8);
    g.gain.setValueAtTime(mult === 2 ? 0.012 : 0.025, t0 + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.4);
    o.connect(lp).connect(g).connect(Music.out);
    o.start(t0);
    o.stop(t0 + dur + 0.5);
  }
}

function musicDrum(ac, t0, vol, pitch) {
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch, t0);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.5, t0 + 0.25);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
  o.connect(g).connect(Music.out);
  o.start(t0);
  o.stop(t0 + 0.4);
  const len = Math.floor(ac.sampleRate * 0.05);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = ac.createBufferSource();
  n.buffer = buf;
  const ng = ac.createGain();
  ng.gain.value = vol * 0.3;
  n.connect(ng).connect(Music.out);
  n.start(t0);
}

function musicTick() {
  const ac = Snd.ctx;
  if (!ac || !Music.out) return;
  const battle = G.combatT > 0 && !G.paused;
  while (Music.next < ac.currentTime + 0.5) {
    const t0 = Music.next;
    const st = Music.step % 64;
    const bar = Math.floor(st / 16);
    if (st === 0 && Math.floor(Music.step / 64) % 3 === 0) Music.phrase = makePhrase();
    if (st % 16 === 0) musicDrone(ac, BASS[bar], t0, MUSIC_STEP * 16);
    const s16 = st % 16;
    if (s16 === 0 || s16 === 8) musicDrum(ac, t0, 0.22, 90);
    if (s16 === 6 || s16 === 12) musicDrum(ac, t0, 0.1, 120);
    if (battle && (s16 % 2 === 1 || s16 === 4 || s16 === 14)) musicDrum(ac, t0, s16 % 2 ? 0.07 : 0.15, 140);
    const deg = Music.phrase[st];
    if (deg >= 0 && !battle) musicVoice(ac, SCALE[deg], t0, MUSIC_STEP * 3, 0.045);
    if (deg >= 0 && battle && st % 4 === 0) musicVoice(ac, SCALE[deg] / 2, t0, MUSIC_STEP * 2, 0.05);
    Music.next += MUSIC_STEP;
    Music.step++;
  }
}

function startMusic() {
  const ac = audioCtx();
  if (!ac || !Music.on || Music.timer) return;
  if (ac.state === 'suspended') ac.resume();
  Music.out = ac.createGain();
  Music.out.gain.value = 0.7;
  Music.out.connect(ac.destination);
  Music.next = ac.currentTime + 0.1;
  Music.step = 0;
  Music.phrase = makePhrase();
  Music.timer = setInterval(musicTick, 120);
}

function stopMusic() {
  if (Music.timer) clearInterval(Music.timer);
  Music.timer = null;
  const ac = Snd.ctx;
  if (Music.out && ac) {
    const g = Music.out;
    g.gain.setValueAtTime(g.gain.value, ac.currentTime);
    g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.5);
    setTimeout(() => g.disconnect(), 800);
  }
  Music.out = null;
}

function setMusic(on) {
  Music.on = on;
  storageSet('norsecraft.music', on ? '1' : '0');
  $('music').classList.toggle('off', !on);
  if (on) startMusic(); else stopMusic();
}

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
  $('continue').addEventListener('click', () => {
    audioCtx();
    const a = saveInfo('auto'), m = saveInfo('manual');
    const slot = a && (!m || a.savedAt >= m.savedAt) ? 'auto' : 'manual';
    resumeGame(slot);
  });
  $('save').addEventListener('click', () => {
    $('save-note').textContent = saveGame('manual', UI.cam, UI.groups) ? 'Game saved.' : 'Could not save: this browser is blocking storage.';
    refreshSaveButtons();
  });
  $('load').addEventListener('click', () => {
    $('pause').style.display = 'none';
    resumeGame('manual');
  });
  $('music').addEventListener('click', () => { audioCtx(); setMusic(!Music.on); });
  Music.on = storageGet('norsecraft.music') !== '0';
  $('music').classList.toggle('off', !Music.on);
  refreshSaveButtons();
  $('help-btn').addEventListener('click', toggleHelp);
  $('help-close').addEventListener('click', toggleHelp);
  $('menu-btn').addEventListener('click', togglePause);
  $('resume').addEventListener('click', togglePause);
  $('restart').addEventListener('click', () => {
    $('pause').style.display = 'none';
    G.paused = false;
    if (G.mission) startMission(G.mission.id);
    else if (G.tut) startTutorial();
    else startGame();
  });
  $('campaign-btn').addEventListener('click', () => { audioCtx(); showCampaign(); });
  $('camp-back').addEventListener('click', () => { $('campaign').style.display = 'none'; });
  $('brief-back').addEventListener('click', () => { $('briefing').style.display = 'none'; showCampaign(); });
  $('tutorial').addEventListener('click', () => { audioCtx(); startTutorial(); });
  $('obj-skip').addEventListener('click', e => { e.stopPropagation(); tutSkip(); });
  $('objective').addEventListener('click', () => $('objective').classList.toggle('min'));
  $('quit').addEventListener('click', toTitle);
  $('again').addEventListener('click', () => {
    $('end').style.display = 'none';
    if (G.mission) {
      const i = G.mission.id;
      if (G.over !== 'victory') startMission(i);
      else if (i + 1 < MISSIONS.length) showBriefing(i + 1);
      else { $('title').style.display = 'flex'; showCampaign(); }
    } else if (G.tut && !G.tut.complete) startTutorial();
    else startGame();
  });
  $('to-title').addEventListener('click', toTitle);
  $('mute').addEventListener('click', () => {
    Snd.muted = !Snd.muted;
    $('mute').textContent = Snd.muted ? '🔇' : '🔊';
  });
  $('speed-sel').addEventListener('change', e => { G.speed = +e.target.value; });

  // Faction preview portraits.
  for (const f of ['vikings', 'jotnar']) {
    const box = $('pv-' + f);
    for (const t of ['worker', 'melee', 'ranged', 'rider', 'siege', 'caster']) {
      const c = document.createElement('canvas');
      c.width = 46; c.height = 46;
      box.appendChild(c);
      drawIcon(c, 'unit', t, f, FACTIONS[f].color);
    }
  }
}

function refreshSaveButtons() {
  const a = saveInfo('auto'), m = saveInfo('manual');
  const best = a && (!m || a.savedAt >= m.savedAt) ? a : m;
  $('continue-box').hidden = !best;
  if (best) $('continue-info').textContent = best.text;
  $('load').disabled = !m;
  $('load').style.opacity = m ? '' : '0.5';
  if (m) $('load').title = m.text;
}

function resumeGame(slot) {
  let r;
  try { r = loadSave(slot); } catch (e) { r = null; }
  if (!r) { refreshSaveButtons(); return; }
  Setup.faction = humanPlayer().faction;
  enterGame();
  UI.groups = r.groups;
  if (r.cam) { UI.cam.x = r.cam.x; UI.cam.y = r.cam.y; clampCam(); }
  msg('Game loaded.');
}

function toTitle() {
  if (G.map && !G.over) saveGame('auto', UI.cam, UI.groups);
  refreshSaveButtons();
  stopMusic();
  $('pause').style.display = 'none';
  $('end').style.display = 'none';
  $('title').style.display = 'flex';
  G.paused = true;
}

// Small screens start a little zoomed out; frame the hall and its mine.
function frameHome() {
  UI.zoom = Math.max(0.7, Math.min(1, UI.vh / 480));
  const hall = G.ents.find(e => e.type === 'hall' && e.owner === G.human);
  const mine = nearestMine(hall.x, hall.y);
  centerOn((hall.x + mine.x) / 2, (hall.y + mine.y) / 2);
}

function startGame() {
  newGame({ faction: Setup.faction, difficulty: Setup.difficulty, speed: Setup.speed });
  enterGame();
  frameHome();
  const p = humanPlayer();
  const foe = G.players[1];
  msg(`The ${FACTIONS[foe.faction].short} gather beyond the fjord. Build up and destroy them!`);
  msg(UI.touch ? `Tap a ${unitName('worker', p.faction)}, then tap the gold mine to start mining.`
    : `Right-click the gold mine with your ${unitName('worker', p.faction)}s to start mining.`);
  msg('More gold lies out in the wilds. Look for the gold marks on the minimap.');
}

// Shared setup for a fresh or loaded game.
function enterGame() {
  G.over = null;
  G.autoT = 60;
  buildTerrain();
  UI.selected.clear();
  UI.groups = {};
  UI.placing = null;
  UI.targeting = null;
  UI.menu = 'main';
  UI.sig = '';
  G.endShown = false;
  $('speed-sel').value = String(G.speed);
  $('title').style.display = 'none';
  $('end').style.display = 'none';
  $('pause').style.display = 'none';
  $('save-note').textContent = '';
  resize();
  startMusic();
  tutRender();
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
  if (G.tut) {
    tutRender();
    if (win) {
      // Point straight at a real game on the gentlest setting.
      Setup.difficulty = 'beginner';
      document.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('on', x.dataset.diff === 'beginner'));
    }
    $('end-title').textContent = win ? 'Tutorial complete' : 'Defeat';
    $('end-text').textContent = win
      ? 'The raiders are beaten and your village stands. You are ready for a real battle: try one on Beginner.'
      : 'The raiders got the better of you this time. Give it another go.';
    $('again').textContent = win ? 'Play a real game' : 'Try again';
    $('end-stats').innerHTML = '';
    $('end').classList.toggle('win', win);
    $('end').style.display = 'flex';
    return;
  }
  $('again').textContent = 'Play again';
  if (G.mission) {
    const i = G.mission.id;
    const def = MISSIONS[i];
    const last = i + 1 >= MISSIONS.length;
    missionRender();
    $('end-title').textContent = win ? (last ? 'The saga is complete' : `Chapter ${i + 1} won`) : 'Defeat';
    $('end-text').textContent = win ? def.win : 'The chapter is lost, but a saga is made of second chances. Try again.';
    $('again').textContent = win ? (last ? 'Back to the saga' : `Chapter ${i + 2}: ${MISSIONS[i + 1].name}`) : 'Try again';
  }
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
  if (G.over && !G.endShown) { setTimeout(showEnd, 1200); G.endShown = true; clearAutosave(); }
  if (!G.over && !G.paused) {
    G.autoT -= dt;
    if (G.autoT <= 0) { G.autoT = 60; saveGame('auto', UI.cam, UI.groups); }
  }
  tutorialUpdate(dt);
  missionUpdate(dt);
  scrollCamera(dt);
  if (UI.mouseWorld) UI.mouseWorld = toWorld(UI.mouse.x, UI.mouse.y);
  UI.hover = UI.mouse.in && UI.mouseWorld ? entityAt(UI.mouseWorld.x, UI.mouseWorld.y) : null;
  const view = $('view');
  const ctx = view.getContext('2d');
  ctx.setTransform(UI.dpr * UI.zoom, 0, 0, UI.dpr * UI.zoom, 0, 0);
  ctx.imageSmoothingEnabled = true;
  render(ctx, UI.cam, viewW(), viewH(), UI);
  miniT -= dt;
  if (miniT <= 0) {
    miniT = 0.15;
    drawMinimap($('minimap').getContext('2d'), UI.cam, viewW(), viewH());
  }
  rebuildPanels();
  updateLive();
}

window.addEventListener('resize', resize);
// Offline support when served from a real site (not inside a preview frame).
if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Touch devices get touch hints from the start.
if (matchMedia('(pointer: coarse)').matches) { UI.touch = true; document.body && document.body.classList.add('touch'); }
// Keep the autosave fresh when the tab is hidden or closed.
const autosaveNow = () => { if (G.map && !G.over && $('title').style.display === 'none') saveGame('auto', UI.cam, UI.groups); };
window.addEventListener('pagehide', autosaveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) autosaveNow(); });
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
