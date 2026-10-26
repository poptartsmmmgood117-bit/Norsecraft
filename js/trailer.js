'use strict';
// Norsecraft trailer: a scripted motion graphic drawn with the game's own
// sprites, buildings and spell effects (render.js), plus a small score.

const TW = 1280, TH = 720, GROUND = 560;

const SCENES = [
  { id: 'title', len: 6.5 },
  { id: 'peoples', len: 7 },
  { id: 'build', len: 6.5 },
  { id: 'magic', len: 7 },
  { id: 'heroes', len: 6.5 },
  { id: 'sea', len: 7.5 },
  { id: 'saga', len: 6.5 },
  { id: 'features', len: 7 },
  { id: 'end', len: 7 },
];
let acc = 0;
for (const s of SCENES) { s.t0 = acc; acc += s.len; }
const TOTAL = acc;

const Tr = { time: 0, playing: true, last: 0, flakes: [], sound: false, ac: null, out: null, cueT: -1, shake: 0 };

// ---------- helpers ----------

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = t => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = t => Math.pow(clamp(t), 2);
// 0 -> 1 over [a, b] seconds of local time.
const ramp = (t, a, b) => clamp((t - a) / (b - a));
// Fade in over [a, a+d], fade out over [b-d, b].
const fade = (t, a, b, d = 0.5) => Math.min(ramp(t, a, a + d), 1 - ramp(t, b - d, b));

function rngSeq(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

for (let i = 0, r = rngSeq(7); i < 170; i++) Tr.flakes.push({ x: r() * TW, y: r() * TH, s: 0.5 + r() * 1.8, v: 18 + r() * 40, w: r() * 6 });

function sky(ctx, top = '#0b1622', bottom = '#1d3346') {
  const g = ctx.createLinearGradient(0, 0, 0, TH);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TW, TH);
}

function aurora(ctx, t, alpha = 1) {
  for (let band = 0; band < 3; band++) {
    ctx.beginPath();
    for (let x = 0; x <= TW; x += 20) {
      const y = 140 + band * 38 + Math.sin(x / 210 + t * 0.4 + band) * 34 + Math.sin(x / 90 - t * 0.7) * 10;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(TW, 0); ctx.lineTo(0, 0); ctx.closePath();
    const g = ctx.createLinearGradient(0, 60, 0, 260);
    g.addColorStop(0, 'rgba(60,220,170,0)');
    g.addColorStop(1, `rgba(${band === 1 ? '120,200,255' : '60,230,170'},${0.16 * alpha})`);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

function mountains(ctx, base, color, seed, amp = 150) {
  const r = rngSeq(seed);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, TH);
  let x = 0;
  ctx.lineTo(0, base - r() * amp);
  while (x < TW) {
    x += 60 + r() * 90;
    ctx.lineTo(x, base - amp * (0.3 + r() * 0.7));
  }
  ctx.lineTo(TW, TH);
  ctx.closePath();
  ctx.fill();
}

function snowGround(ctx, y = GROUND) {
  const g = ctx.createLinearGradient(0, y, 0, TH);
  g.addColorStop(0, '#d9e3e8');
  g.addColorStop(1, '#9fb1bb');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, TW, TH - y);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(0, y, TW, 3);
}

function sea(ctx, t, top, deep = '#16324a', light = '#2e5a80') {
  const g = ctx.createLinearGradient(0, top, 0, TH);
  g.addColorStop(0, light);
  g.addColorStop(1, deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, TW, TH - top);
  ctx.strokeStyle = 'rgba(200,230,245,0.25)';
  ctx.lineWidth = 2;
  for (let row = 0; row < 9; row++) {
    const y = top + 14 + row * ((TH - top) / 9);
    ctx.beginPath();
    for (let x = -40; x <= TW + 40; x += 40) {
      const ox = (x + t * (30 + row * 6)) % (TW + 80) - 40;
      ctx.moveTo(ox, y);
      ctx.quadraticCurveTo(ox + 10, y - 4, ox + 20, y);
    }
    ctx.stroke();
  }
}

function snow(ctx, t, alpha = 1) {
  ctx.fillStyle = `rgba(255,255,255,${0.8 * alpha})`;
  for (const f of Tr.flakes) {
    const y = (f.y + t * f.v) % TH;
    const x = (f.x + Math.sin(t * 0.8 + f.w) * 14 + TW) % TW;
    ctx.beginPath(); ctx.arc(x, y, f.s, 0, Math.PI * 2); ctx.fill();
  }
}

function caption(ctx, text, t, a, b, y = 110, size = 54) {
  const k = fade(t, a, b, 0.6);
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = k;
  ctx.textAlign = 'center';
  ctx.font = `700 ${size}px Cinzel, Georgia, serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#f1d38a';
  ctx.fillText(text, TW / 2, y + (1 - ease(ramp(t, a, a + 0.8))) * 24);
  ctx.restore();
}

function label(ctx, text, x, y, alpha, size = 18, color = '#e9e1cf', font = 'Alegreya Sans, sans-serif', weight = 500) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function sprite(ctx, type, faction, x, y, scale, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawUnitSprite(ctx, type, faction, o.color || FACTIONS[faction].color, {
    dir: o.dir || 1, walk: o.walk || 0, atk: o.atk || 0, carry: o.carry || null, chop: false, scale: 1,
  });
  ctx.restore();
}

// A building drawn at a scale, rising out of the ground as reveal goes 0 -> 1.
function building(ctx, type, faction, x, y, scale, reveal) {
  if (reveal <= 0) return;
  const img = buildingImage(type, faction, FACTIONS[faction].color);
  const h = img.height * ease(reveal);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, img.height - h, img.width, h, -img.width / 2, -h, img.width, h);
  ctx.restore();
  if (reveal < 1) {
    ctx.fillStyle = `rgba(230,236,240,${0.6 * (1 - reveal)})`;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.arc(x - 50 * scale + i * 20 * scale, y - 4, (6 + i % 3 * 4) * scale * (1.2 - reveal), 0, Math.PI * 2); ctx.fill();
    }
  }
}

function fx(ctx, type, x, y, life, extra = {}) {
  ctx.save();
  drawEffect(ctx, { type, x, y, t: life, ...extra }, 1);
  ctx.restore();
}

function vignette(ctx) {
  const g = ctx.createRadialGradient(TW / 2, TH / 2, TH * 0.35, TW / 2, TH / 2, TH * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TW, TH);
}

// ---------- scenes ----------

const DRAW = {
  title(ctx, t) {
    sky(ctx);
    aurora(ctx, t, ease(ramp(t, 0, 2)));
    mountains(ctx, 470, '#16222c', 3, 190);
    mountains(ctx, 520, '#101a22', 11, 120);
    sea(ctx, t, 520, '#0b1a26', '#1b3a52');
    // A longship crossing the fjord in silhouette.
    ctx.save();
    ctx.globalAlpha = 0.9;
    sprite(ctx, 'warship', 'vikings', -120 + t * 120, 560, 2.2, { color: '#7a2a24', walk: t * 3 });
    ctx.restore();
    snow(ctx, t, 0.8);
    const word = 'NORSECRAFT';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 120px Cinzel, Georgia, serif';
    const total = ctx.measureText(word).width;
    let x = TW / 2 - total / 2;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      const w = ctx.measureText(ch).width;
      const k = ease(ramp(t, 0.6 + i * 0.09, 1.3 + i * 0.09));
      const out = 1 - ramp(t, 5.6, 6.4);
      ctx.globalAlpha = k * out;
      ctx.shadowColor = 'rgba(241,207,74,0.6)';
      ctx.shadowBlur = 30 * k;
      ctx.fillStyle = '#f1d38a';
      ctx.save();
      ctx.translate(x + w / 2, 330);
      ctx.scale(1.6 - 0.6 * k, 1.6 - 0.6 * k);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += w;
    }
    ctx.restore();
    label(ctx, 'A REAL-TIME STRATEGY SAGA OF THE NORTH', TW / 2, 395, fade(t, 2.2, 6.4, 0.8), 22, '#cfe3ee', 'Alegreya Sans, sans-serif', 500);
    if (t > 0.7 && t < 0.9) Tr.cue('drum');
  },

  peoples(ctx, t) {
    sky(ctx, '#132331', '#2b4255');
    mountains(ctx, 470, '#24384a', 5, 160);
    snowGround(ctx);
    snow(ctx, t, 0.6);
    caption(ctx, 'Two peoples. One frozen land.', t, 0.2, 6.8, 120);
    const v = ['worker', 'melee', 'ranged', 'rider', 'siege', 'caster', 'hero'];
    v.forEach((type, i) => {
      const tx = 90 + i * 72;
      const k = ease(ramp(t, 0.6 + i * 0.12, 2.0 + i * 0.12));
      const x = -120 + (tx + 120) * k;
      sprite(ctx, type, 'vikings', x, GROUND - 12, type === 'hero' ? 2.0 : 2.4, { walk: k < 1 ? t * 9 : 0 });
      label(ctx, unitName(type, 'vikings'), tx, GROUND + 52 + (i % 2) * 22, fade(t, 2.4 + i * 0.1, 6.8), 16);
    });
    v.forEach((type, i) => {
      const tx = TW - 90 - i * 72;
      const k = ease(ramp(t, 0.6 + i * 0.12, 2.0 + i * 0.12));
      const x = TW + 120 - (TW + 120 - tx) * k;
      sprite(ctx, type, 'jotnar', x, GROUND - 12, type === 'hero' ? 1.6 : 2.4, { dir: -1, walk: k < 1 ? t * 9 : 0 });
      label(ctx, unitName(type, 'jotnar'), tx, GROUND + 52 + (i % 2) * 22, fade(t, 2.4 + i * 0.1, 6.8), 16);
    });
    label(ctx, 'Vikings of Midgard', 310, 250, fade(t, 1.6, 6.8), 34, '#e98a7a', 'Cinzel, Georgia, serif', 700);
    label(ctx, 'Jötnar of Jötunheim', TW - 310, 250, fade(t, 1.6, 6.8), 34, '#8ccbe8', 'Cinzel, Georgia, serif', 700);
    label(ctx, 'ᛟ', TW / 2, 430, fade(t, 1.2, 6.8), 64, '#f1d38a', 'serif', 400);
    if (t > 0.2 && t < 0.4) Tr.cue('drum');
  },

  build(ctx, t) {
    sky(ctx, '#18293a', '#355068');
    mountains(ctx, 480, '#2a3f52', 9, 140);
    snowGround(ctx);
    caption(ctx, 'Raise your settlement', t, 0.2, 6.3, 110);
    const rows = [
      ['hall', 220, 1.5], ['farm', 430, 1.4], ['barracks', 640, 1.4], ['mill', 840, 1.4], ['tower', 1010, 1.4], ['temple', 1150, 1.4],
    ];
    rows.forEach(([type, x, sc], i) => {
      const r = ramp(t, 0.7 + i * 0.55, 1.7 + i * 0.55);
      building(ctx, type, 'vikings', x, GROUND + 6, sc, r);
      label(ctx, bldgName(type, 'vikings'), x, GROUND + 40, fade(t, 1.6 + i * 0.55, 6.3), 17);
      if (r > 0 && r < 0.12) Tr.cue('thud');
    });
    // Thralls hauling gold and lumber in the foreground.
    for (let i = 0; i < 5; i++) {
      const x = ((t * 70 + i * 260) % (TW + 200)) - 100;
      sprite(ctx, 'worker', 'vikings', x, GROUND + 92, 1.9, { walk: t * 8 + i, carry: i % 2 ? 'gold' : 'wood' });
    }
    // Treasury counting up.
    const gold = Math.floor(600 + 2150 * ease(ramp(t, 1, 5.5)));
    const wood = Math.floor(400 + 1280 * ease(ramp(t, 1.2, 5.5)));
    const a = fade(t, 0.8, 6.3);
    label(ctx, `● ${gold.toLocaleString()} gold    ▮ ${wood.toLocaleString()} lumber`, TW / 2, 170, a, 24, '#f1cf4a', 'Alegreya Sans, sans-serif', 700);
  },

  magic(ctx, t) {
    sky(ctx, '#0e1620', '#23303d');
    mountains(ctx, 480, '#1a2530', 13, 150);
    snowGround(ctx);
    caption(ctx, 'Call on the gods', t, 0.2, 6.8, 110);
    const half = t < 3.5;
    if (half) {
      // The Völva calls down Thor's Storm on a troll warband.
      const lit = ramp(t, 0.8, 1.2);
      sprite(ctx, 'caster', 'vikings', 300, GROUND - 6, 3.2, { atk: (t % 0.6) < 0.3 ? 0.2 : 0 });
      label(ctx, "Thor's Storm", 300, GROUND + 60, fade(t, 0.6, 3.5), 26, '#ffe39a', 'Cinzel, Georgia, serif', 700);
      ctx.save();
      ctx.globalAlpha = 0.5 * lit;
      ctx.fillStyle = '#2c3346';
      ctx.beginPath(); ctx.ellipse(880, 230, 330, 70, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      for (let i = 0; i < 5; i++) sprite(ctx, 'melee', 'jotnar', 720 + i * 80, GROUND - 6 + (i % 2) * 18, 2.4, { dir: -1 });
      const bolts = [1.0, 1.35, 1.7, 2.1, 2.5, 2.8];
      bolts.forEach((b, i) => {
        if (t >= b && t < b + 0.25) {
          const bx = 730 + ((i * 97) % 330);
          ctx.save(); ctx.translate(bx, GROUND - 10); ctx.scale(1.8, 2.4);
          drawEffect(ctx, { type: 'bolt', x: 0, y: 0, t: 0.25 - (t - b), seed: i * 31 }, 1);
          ctx.restore();
          ctx.fillStyle = `rgba(255,250,220,${0.25 * (1 - (t - b) / 0.25)})`;
          ctx.fillRect(0, 0, TW, TH);
          Tr.shake = Math.max(Tr.shake, 6);
          Tr.cue('thunder');
        }
      });
    } else {
      // The Frost Shaman answers: wolves from the Ironwood and a blizzard.
      const lt = t - 3.5;
      sprite(ctx, 'caster', 'jotnar', TW - 300, GROUND - 6, 3.2, { dir: -1, atk: (lt % 0.6) < 0.3 ? 0.2 : 0 });
      label(ctx, 'Frost Wolves · Fimbulwinter', TW - 320, GROUND + 60, fade(lt, 0.2, 3.3), 26, '#9fe8ff', 'Cinzel, Georgia, serif', 700);
      for (let i = 0; i < 2; i++) {
        const st = ramp(lt, 0.3 + i * 0.3, 1.2 + i * 0.3);
        if (st > 0) {
          ctx.save(); ctx.globalAlpha = st;
          sprite(ctx, 'wolf', 'jotnar', TW - 520 - i * 90, GROUND + 4 + i * 16, 2.6, { dir: -1 });
          ctx.restore();
          if (st < 1) fx(ctx, 'summon', TW - 520 - i * 90, GROUND - 10, 0.9 * (1 - st), { faction: 'jotnar' });
        }
      }
      for (let i = 0; i < 4; i++) sprite(ctx, 'melee', 'vikings', 170 + i * 80, GROUND - 6 + (i % 2) * 18, 2.4);
      if (lt > 0.9) {
        ctx.save(); ctx.translate(290, GROUND - 20); ctx.scale(3.2, 3.2);
        drawArea(ctx, { kind: 'blizzard', x: 0, y: 0, r: 64, age: lt });
        ctx.restore();
        if (lt < 1.1) Tr.cue('wind');
      }
    }
  },

  heroes(ctx, t) {
    sky(ctx, '#151d28', '#3a3226');
    mountains(ctx, 480, '#2a2620', 17, 140);
    snowGround(ctx);
    caption(ctx, 'Heroes rise', t, 0.2, 6.3, 110);
    // Sigrún: levels up, then sounds the War Cry.
    const lv = 1 + Math.min(4, Math.floor(ramp(t, 0.6, 2.6) * 4.999));
    ctx.save(); ctx.fillStyle = 'rgba(255,215,110,0.22)';
    ctx.beginPath(); ctx.ellipse(380, GROUND + 20, 90, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    sprite(ctx, 'hero', 'vikings', 380, GROUND - 10, 3.6, { atk: t > 2.8 && t < 3.2 ? 0.2 : 0 });
    for (let i = 0; i < lv; i++) { ctx.fillStyle = '#ffd86a'; ctx.fillRect(338 + i * 18, GROUND - 190, 13, 13); }
    for (let i = 1; i <= 4; i++) {
      const at = 0.6 + (i - 0.5) * 0.5;
      if (t > at && t < at + 1.2) { ctx.save(); ctx.translate(380, GROUND - 40); ctx.scale(2.4, 2.4); drawEffect(ctx, { type: 'levelup', x: 0, y: 0, t: 1.2 - (t - at) }, 1); ctx.restore(); }
    }
    if (t > 2.8 && t < 3.7) { ctx.save(); ctx.translate(380, GROUND); ctx.scale(1.4, 1.4); drawEffect(ctx, { type: 'warcry', x: 0, y: 0, t: 0.9 - (t - 2.8) }, 1); ctx.restore(); Tr.cue('horn'); }
    label(ctx, 'Sigrún Shield-Maiden', 380, GROUND + 70, fade(t, 0.8, 6.3), 28, '#ffe39a', 'Cinzel, Georgia, serif', 700);
    label(ctx, `Level ${lv} · War Cry`, 380, GROUND + 100, fade(t, 1.0, 6.3), 18);
    // Hrungnir: the Earthshaker.
    const slam = t > 4 && t < 4.8;
    sprite(ctx, 'hero', 'jotnar', 910, GROUND - 10, 3.0, { dir: -1, atk: slam ? 0.25 : 0 });
    if (slam) {
      ctx.save(); ctx.translate(910, GROUND); ctx.scale(2.6, 2.6); drawEffect(ctx, { type: 'quake', x: 0, y: 0, t: 0.8 - (t - 4) }, 1); ctx.restore();
      Tr.shake = Math.max(Tr.shake, 12 * (1 - (t - 4) / 0.8));
      Tr.cue('thud');
    }
    label(ctx, 'Hrungnir Stone-Heart', 910, GROUND + 70, fade(t, 1.4, 6.3), 28, '#9fe8ff', 'Cinzel, Georgia, serif', 700);
    label(ctx, 'Earthshaker', 910, GROUND + 100, fade(t, 1.6, 6.3), 18);
  },

  sea(ctx, t) {
    sky(ctx, '#142433', '#2c4a63');
    mountains(ctx, 330, '#1d3140', 21, 120);
    sea(ctx, t, 330);
    caption(ctx, 'Take to the sea', t, 0.2, 7.3, 110);
    const ships = [
      { type: 'warship', f: 'vikings', y: 470, x0: -160, v: 120, s: 3.0 },
      { type: 'transport', f: 'vikings', y: 600, x0: -380, v: 105, s: 3.0 },
      { type: 'warship', f: 'jotnar', y: 420, x0: TW + 180, v: -95, s: 2.6, sinkAt: 4.2 },
    ];
    for (const sh of ships) {
      const x = sh.x0 + sh.v * t;
      if (sh.sinkAt && t > sh.sinkAt) {
        const k = ramp(t, sh.sinkAt, sh.sinkAt + 1.5);
        ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(0, k * 30);
        sprite(ctx, sh.type, sh.f, x, sh.y + Math.sin(t * 2) * 3, sh.s, { dir: -1, walk: t * 3 });
        ctx.restore();
        if (k < 0.5) fx(ctx, 'boom', x, sh.y - 20, 0.8 * (1 - k * 2), { r: 70 });
        continue;
      }
      // Wake.
      ctx.strokeStyle = 'rgba(230,240,245,0.5)'; ctx.lineWidth = 3;
      const back = x - Math.sign(sh.v) * 70;
      ctx.beginPath(); ctx.moveTo(back, sh.y + 10); ctx.lineTo(back - Math.sign(sh.v) * 60, sh.y - 6);
      ctx.moveTo(back, sh.y + 16); ctx.lineTo(back - Math.sign(sh.v) * 60, sh.y + 32); ctx.stroke();
      sprite(ctx, sh.type, sh.f, x, sh.y + Math.sin(t * 2 + sh.y) * 3, sh.s, { dir: Math.sign(sh.v), walk: t * 3 });
    }
    // Boulders and bolts arcing between the fleets.
    const shots = [[1.6, 0], [2.4, 1], [3.2, 0], [3.8, 0]];
    for (const [st, from] of shots) {
      const k = ramp(t, st, st + 0.8);
      if (k <= 0 || k >= 1) continue;
      const a = from === 0 ? { x: -160 + 120 * st + 40, y: 440 } : { x: TW + 180 - 95 * st - 40, y: 390 };
      const b = from === 0 ? { x: TW + 180 - 95 * (st + 0.8), y: 400 } : { x: -160 + 120 * (st + 0.8), y: 450 };
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 120;
      ctx.fillStyle = from ? '#6d6560' : '#d8c7a4';
      ctx.beginPath(); ctx.arc(x, y, from ? 9 : 6, 0, Math.PI * 2); ctx.fill();
      if (k > 0.9) Tr.cue('thud');
    }
    label(ctx, 'Drakkar · Knarr · Naglfar', TW / 2, 175, fade(t, 0.8, 7.3), 22, '#cfe3ee');
  },

  saga(ctx, t) {
    sky(ctx, '#0c0f14', '#2a1d14');
    // Embers rising.
    const r = rngSeq(3);
    for (let i = 0; i < 70; i++) {
      const x = r() * TW, sp = 20 + r() * 50, y = TH - ((t * sp + r() * TH) % TH);
      ctx.fillStyle = `rgba(255,${120 + r() * 80},60,${0.5 * r()})`;
      ctx.fillRect(x + Math.sin(t + i) * 8, y, 2.5, 2.5);
    }
    caption(ctx, 'Five chapters. One saga.', t, 0.2, 6.3, 140);
    const ch = [['The Burning', 'Shore'], ['Gold of', 'the Giants'], ['The Long', 'Winter'], ['The Völva of', 'the Ironwood'], ['Ragnarök', '']];
    const runes = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ'];
    ch.forEach((name, i) => {
      const x = 170 + i * 235;
      const k = fade(t, 0.9 + i * 0.4, 6.3);
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = 'rgba(241,211,138,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, 360, 62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      label(ctx, runes[i], x, 388, k, 78, '#f1d38a', 'serif', 400);
      label(ctx, `CHAPTER ${i + 1}`, x, 470, k, 14, '#a99f8a', 'Alegreya Sans, sans-serif', 700);
      label(ctx, name[0], x, 500, k, 20, '#e9e1cf', 'Cinzel, Georgia, serif', 700);
      label(ctx, name[1], x, 526, k, 20, '#e9e1cf', 'Cinzel, Georgia, serif', 700);
      if (t > 0.9 + i * 0.4 && t < 1.0 + i * 0.4) Tr.cue('drum');
    });
  },

  features(ctx, t) {
    sky(ctx, '#101b26', '#22384a');
    aurora(ctx, t, 0.6);
    mountains(ctx, 560, '#17242f', 31, 160);
    snow(ctx, t, 0.5);
    const lines = [
      ['Skirmish with up to four warbands', 'Allied or free-for-all · small, medium and large maps'],
      ['Fjords, fords and fleets', 'Ferry an army across the water in a Knarr'],
      ['A tutorial and a five-chapter saga', 'Learn the ropes, then lead the Vikings to Ragnarök'],
      ['Play on your phone', 'Add it to your home screen · saves and autosave'],
    ];
    lines.forEach(([h, s], i) => {
      const a = 0.3 + i * 1.3;
      const k = ease(ramp(t, a, a + 0.6));
      const out = 1 - ramp(t, 6.4, 7);
      const y = 200 + i * 105;
      ctx.save();
      ctx.globalAlpha = k * out;
      ctx.translate((1 - k) * -80, 0);
      ctx.fillStyle = '#f1d38a';
      ctx.font = '700 36px Cinzel, Georgia, serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
      ctx.fillText('ᛉ', 170, y);
      ctx.fillText(h, 230, y);
      ctx.font = '500 21px Alegreya Sans, sans-serif';
      ctx.fillStyle = '#cfe3ee';
      ctx.fillText(s, 232, y + 32);
      ctx.restore();
      if (t > a && t < a + 0.1) Tr.cue('drum');
    });
  },

  end(ctx, t) {
    sky(ctx);
    aurora(ctx, t, 1);
    mountains(ctx, 500, '#16222c', 3, 190);
    sea(ctx, t, 560, '#0b1a26', '#1b3a52');
    // Snowy headlands for the two heroes to stand on.
    for (const [cx, w] of [[170, 260], [TW - 170, 260]]) {
      ctx.fillStyle = '#9fb1bb';
      ctx.beginPath(); ctx.ellipse(cx, 600, w, 52, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#d9e3e8';
      ctx.beginPath(); ctx.ellipse(cx, 604, w - 14, 44, 0, Math.PI, 0); ctx.fill();
    }
    sprite(ctx, 'hero', 'vikings', 200, 552, 2.4);
    sprite(ctx, 'hero', 'jotnar', TW - 200, 552, 2.0, { dir: -1 });
    snow(ctx, t, 0.8);
    const k = ease(ramp(t, 0.2, 1.4)) * (1 - ramp(t, 6.4, 7));
    ctx.save();
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.font = '700 110px Cinzel, Georgia, serif';
    ctx.shadowColor = 'rgba(241,207,74,0.6)'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#f1d38a';
    ctx.fillText('NORSECRAFT', TW / 2, 300);
    ctx.restore();
    label(ctx, 'Free to play in your browser', TW / 2, 370, fade(t, 1.0, 7), 30, '#e9e1cf', 'Alegreya Sans, sans-serif', 500);
    label(ctx, 'poptartsmmmgood117-bit.github.io/Norsecraft', TW / 2, 420, fade(t, 1.4, 7), 24, '#9fe8ff', 'Alegreya Sans, sans-serif', 700);
    label(ctx, 'Every sprite, building and note made in code', TW / 2, 470, fade(t, 2.0, 7), 18, '#a99f8a');
    if (t > 0.2 && t < 0.35) Tr.cue('drum');
  },
};

// ---------- sound ----------

function audio() {
  if (!Tr.ac) {
    try { Tr.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    Tr.out = Tr.ac.createGain();
    Tr.out.gain.value = 0.8;
    Tr.out.connect(Tr.ac.destination);
  }
  return Tr.ac;
}

function tone(f, dur, type, vol, slide = 0, delay = 0) {
  const ac = Tr.ac, t0 = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(Tr.out);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noiseBurst(dur, vol, freq) {
  const ac = Tr.ac, len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ac.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(Tr.out);
  src.start();
}

// One-shot sound cues, rate-limited so a cue held for several frames plays once.
Tr.cue = function (name) {
  if (!Tr.sound || !Tr.ac || !Tr.playing) return;
  const now = performance.now();
  Tr.cues = Tr.cues || {};
  if (Tr.cues[name] && now - Tr.cues[name] < 260) return;
  Tr.cues[name] = now;
  if (name === 'drum') { tone(90, 0.4, 'sine', 0.5, -45); noiseBurst(0.06, 0.15, 900); }
  else if (name === 'thud') { tone(70, 0.35, 'sine', 0.45, -30); noiseBurst(0.2, 0.2, 400); }
  else if (name === 'thunder') { noiseBurst(1.0, 0.35, 280); tone(50, 0.9, 'sawtooth', 0.05, -15); }
  else if (name === 'wind') { noiseBurst(2.2, 0.15, 1200); }
  else if (name === 'horn') { [196, 247, 294].forEach((f, i) => tone(f, 0.8, 'sawtooth', 0.06, 0, i * 0.12)); }
};

// A drone under everything while sound is on.
function startDrone() {
  const ac = Tr.ac;
  if (Tr.drone) return;
  Tr.drone = [];
  for (const [f, v] of [[73.42, 0.05], [110, 0.03], [146.8, 0.015]]) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 360;
    const g = ac.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(v, ac.currentTime + 1.5);
    o.connect(lp).connect(g).connect(Tr.out);
    o.start();
    Tr.drone.push({ o, g });
  }
}
function stopDrone() {
  if (!Tr.drone) return;
  for (const d of Tr.drone) { d.g.gain.linearRampToValueAtTime(0, Tr.ac.currentTime + 0.4); d.o.stop(Tr.ac.currentTime + 0.5); }
  Tr.drone = null;
}

// ---------- loop ----------

function sceneAt(time) {
  for (const s of SCENES) if (time < s.t0 + s.len) return s;
  return SCENES[SCENES.length - 1];
}

function drawFrame(ctx, time) {
  const s = sceneAt(time);
  const t = time - s.t0;
  ctx.save();
  if (Tr.shake > 0.3) ctx.translate((Math.random() - 0.5) * Tr.shake, (Math.random() - 0.5) * Tr.shake);
  DRAW[s.id](ctx, t);
  ctx.restore();
  Tr.shake *= 0.86;
  // Dip to black between scenes.
  const edge = Math.min(t, s.len - t);
  if (edge < 0.35) {
    ctx.fillStyle = `rgba(0,0,0,${1 - edge / 0.35})`;
    ctx.fillRect(0, 0, TW, TH);
  }
  vignette(ctx);
  // Cinematic bars.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TW, 26);
  ctx.fillRect(0, TH - 26, TW, 26);
}

function startTrailer() {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const scrub = document.getElementById('scrub');
  const fill = document.getElementById('scrub-fill');
  const marks = document.getElementById('scrub-marks');
  const playBtn = document.getElementById('play');
  const soundBtn = document.getElementById('sound');
  const names = ['Title', 'Peoples', 'Build', 'Magic', 'Heroes', 'Sea', 'Saga', 'Features', 'End'];
  SCENES.forEach((s, i) => {
    const m = document.createElement('button');
    m.className = 'mark';
    m.style.left = (s.t0 / TOTAL * 100) + '%';
    m.title = names[i];
    m.setAttribute('aria-label', 'Jump to ' + names[i]);
    m.addEventListener('click', e => { e.stopPropagation(); Tr.time = s.t0 + 0.01; });
    marks.appendChild(m);
  });
  const params = new URLSearchParams(location.search);
  if (params.has('record')) document.body.classList.add('record');

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (Tr.last || now)) / 1000);
    Tr.last = now;
    if (Tr.playing) Tr.time = (Tr.time + dt) % TOTAL;
    drawFrame(ctx, Tr.time);
    fill.style.width = (Tr.time / TOTAL * 100) + '%';
  }
  requestAnimationFrame(frame);

  playBtn.addEventListener('click', () => {
    Tr.playing = !Tr.playing;
    playBtn.textContent = Tr.playing ? 'Pause' : 'Play';
    if (!Tr.playing) stopDrone(); else if (Tr.sound) startDrone();
  });
  document.getElementById('restart').addEventListener('click', () => { Tr.time = 0; Tr.playing = true; playBtn.textContent = 'Pause'; });
  soundBtn.addEventListener('click', () => {
    if (!audio()) return;
    Tr.ac.resume();
    Tr.sound = !Tr.sound;
    soundBtn.textContent = Tr.sound ? 'Sound on' : 'Sound off';
    soundBtn.setAttribute('aria-pressed', String(Tr.sound));
    if (Tr.sound && Tr.playing) startDrone(); else stopDrone();
  });
  scrub.addEventListener('click', e => {
    const r = scrub.getBoundingClientRect();
    Tr.time = clamp((e.clientX - r.left) / r.width) * TOTAL;
  });
  window.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); playBtn.click(); } });
}

window.addEventListener('load', () => {
  // Wait for the fonts so the title cards render in Cinzel from the first frame.
  const go = () => startTrailer();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
});
