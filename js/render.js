'use strict';
// Procedural art and drawing: terrain, units, buildings, effects, fog, minimap.

const R = { terrain: null, tctx: null, miniBase: null, mctx: null, bcache: new Map() };

const PAL = {
  grass: ['#56683a', '#5b6e3d', '#51633a', '#5e7140'],
  snow: ['#dfe7eb', '#e6edf0', '#d7e0e5', '#e1e9ec'],
  water: '#24496a', water2: '#2e5a80',
  rock: '#7d7f82', rockDark: '#55585c',
  pine: '#1f3b2a', pine2: '#2a4c35', trunk: '#4a3322',
};

function rnd(x, y, k) { return hash2(x, y, k + G.map.seed); }

function isSnowGround(x, y) {
  return fbm(x / 9, y / 9, G.map.seed + 4) > 0.55;
}

// ---------- terrain ----------

function buildTerrain() {
  const c = document.createElement('canvas');
  c.width = MAP_W * TILE;
  c.height = MAP_H * TILE;
  R.terrain = c;
  R.tctx = c.getContext('2d');
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) drawGround(R.tctx, x, y);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) drawTileTop(R.tctx, x, y);
  buildMiniBase();
}

function groundKind(x, y) {
  const t = G.map.tile(x, y);
  if (t === T.SNOW) return 'snow';
  if (t === T.GRASS) return 'grass';
  return isSnowGround(x, y) ? 'snow' : 'grass';
}

function drawGround(ctx, x, y) {
  const px = x * TILE, py = y * TILE;
  const t = G.map.tile(x, y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, TILE, TILE);
  ctx.clip();
  if (t === T.WATER) {
    ctx.fillStyle = PAL.water;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = PAL.water2;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 2; k++) {
      const wx = px + 4 + rnd(x, y, 20 + k) * 18, wy = py + 6 + k * 14 + rnd(x, y, 30 + k) * 6;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 4, wy - 3, wx + 8, wy);
      ctx.stroke();
    }
    // Shoreline foam where water meets land.
    ctx.fillStyle = 'rgba(220,235,240,0.55)';
    if (G.map.tile(x, y - 1) !== T.WATER) ctx.fillRect(px, py, TILE, 3);
    if (G.map.tile(x, y + 1) !== T.WATER) ctx.fillRect(px, py + TILE - 3, TILE, 3);
    if (G.map.tile(x - 1, y) !== T.WATER) ctx.fillRect(px, py, 3, TILE);
    if (G.map.tile(x + 1, y) !== T.WATER) ctx.fillRect(px + TILE - 3, py, 3, TILE);
    ctx.restore();
    return;
  }
  const kind = groundKind(x, y);
  const pal = PAL[kind];
  ctx.fillStyle = pal[Math.floor(rnd(x, y, 1) * pal.length)];
  ctx.fillRect(px, py, TILE, TILE);
  // Soft blending toward neighbouring ground types.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nt = G.map.tile(x + dx, y + dy);
    if (nt === T.WATER || nt === T.ROCK && !G.map.inBounds(x + dx, y + dy)) continue;
    const nk = groundKind(x + dx, y + dy);
    if (nk === kind) continue;
    const g = ctx.createLinearGradient(
      px + TILE / 2 + dx * TILE / 2, py + TILE / 2 + dy * TILE / 2,
      px + TILE / 2 + dx * TILE * 0.1, py + TILE / 2 + dy * TILE * 0.1);
    const col = PAL[nk][0];
    g.addColorStop(0, col + 'b0');
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, TILE, TILE);
  }
  // Specks and tufts.
  for (let k = 0; k < 5; k++) {
    const sx = px + rnd(x, y, 40 + k) * TILE, sy = py + rnd(x, y, 50 + k) * TILE;
    if (kind === 'grass') {
      ctx.fillStyle = rnd(x, y, 60 + k) < 0.5 ? '#6c8048' : '#46572f';
      ctx.fillRect(sx, sy, 2, 2);
    } else {
      ctx.fillStyle = rnd(x, y, 60 + k) < 0.5 ? '#c4d2da' : '#f6fafb';
      ctx.fillRect(sx, sy, 2, 1);
    }
  }
  if (t === T.FOREST) {
    ctx.fillStyle = 'rgba(20,35,20,0.35)';
    ctx.fillRect(px, py, TILE, TILE);
  }
  if (t === T.STUMP) {
    const sx = px + 10 + rnd(x, y, 70) * 12, sy = py + 12 + rnd(x, y, 71) * 10;
    ctx.fillStyle = '#3b2a1c';
    ctx.beginPath(); ctx.ellipse(sx, sy, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a3825a';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPine(ctx, cx, by, h, snowy) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx + 2, by, h * 0.3, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.trunk;
  ctx.fillRect(cx - 1.5, by - h * 0.2, 3, h * 0.2);
  for (let i = 0; i < 3; i++) {
    const w = h * (0.42 - i * 0.1), top = by - h * (0.45 + i * 0.22), bot = by - h * (0.12 + i * 0.22);
    ctx.fillStyle = i % 2 ? PAL.pine2 : PAL.pine;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx + w, bot);
    ctx.lineTo(cx - w, bot);
    ctx.closePath();
    ctx.fill();
    if (snowy) {
      ctx.fillStyle = '#eef4f6';
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + w * 0.45, top + (bot - top) * 0.45);
      ctx.lineTo(cx - w * 0.45, top + (bot - top) * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawTileTop(ctx, x, y) {
  const t = G.map.tile(x, y);
  const px = x * TILE, py = y * TILE;
  if (t === T.FOREST) {
    const snowy = isSnowGround(x, y) || rnd(x, y, 5) < 0.3;
    const n = 2 + Math.floor(rnd(x, y, 6) * 2);
    const pts = [];
    for (let k = 0; k < n; k++) pts.push({ x: px + 6 + rnd(x, y, 80 + k) * 20, y: py + 14 + rnd(x, y, 90 + k) * 18, h: 22 + rnd(x, y, 100 + k) * 10 });
    pts.sort((a, b) => a.y - b.y);
    for (const p of pts) drawPine(ctx, p.x, p.y, p.h, snowy);
  } else if (t === T.ROCK) {
    const n = 2 + Math.floor(rnd(x, y, 7) * 2);
    for (let k = 0; k < n; k++) {
      const cx = px + 6 + rnd(x, y, 110 + k) * 20, cy = py + 10 + rnd(x, y, 120 + k) * 16, r = 7 + rnd(x, y, 130 + k) * 6;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(cx + 2, cy + r * 0.5, r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.rockDark;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.rock;
      ctx.beginPath(); ctx.ellipse(cx - 1.5, cy - 2, r * 0.75, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      if (isSnowGround(x, y)) {
        ctx.fillStyle = '#eef3f5';
        ctx.beginPath(); ctx.ellipse(cx - 2, cy - r * 0.45, r * 0.55, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

function redrawDirtyTerrain() {
  const d = G.map.dirty;
  if (!d.length) return;
  const seen = new Set();
  for (const i of d) {
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    drawGround(R.tctx, x, y);
    for (let yy = y; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      const k = yy * MAP_W + xx;
      if (seen.has(k) || !G.map.inBounds(xx, yy)) continue;
      seen.add(k);
      drawTileTop(R.tctx, xx, yy);
    }
    paintMiniTile(x, y);
  }
  d.length = 0;
}

// ---------- minimap ----------

const MINI = 3;

function miniColor(x, y) {
  const t = G.map.tile(x, y);
  if (t === T.WATER) return '#24496a';
  if (t === T.FOREST) return '#1f3b2a';
  if (t === T.ROCK) return '#6d6f72';
  return groundKind(x, y) === 'snow' ? '#cdd7dc' : '#56683a';
}

function buildMiniBase() {
  const c = document.createElement('canvas');
  c.width = MAP_W * MINI;
  c.height = MAP_H * MINI;
  R.miniBase = c;
  R.mbctx = c.getContext('2d');
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) paintMiniTile(x, y);
}

function paintMiniTile(x, y) {
  R.mbctx.fillStyle = miniColor(x, y);
  R.mbctx.fillRect(x * MINI, y * MINI, MINI, MINI);
}

function drawMinimap(ctx, cam, vw, vh) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sx = W / MAP_W, sy = H / MAP_H;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(R.miniBase, 0, 0, W, H);
  for (const e of G.ents) {
    if (e.dead || e.hidden || !isVisibleEnt(e)) continue;
    ctx.fillStyle = e.owner < 0 ? '#e8c547' : e.owner === G.human ? '#7cf06a' : G.players[e.owner].color;
    if (e.owner >= 0 && e.owner !== G.human) ctx.fillStyle = '#ff5040';
    if (e.kind === 'bldg') ctx.fillRect(e.tx * sx, e.ty * sy, e.w * sx, e.h * sy);
    else ctx.fillRect(e.x / TILE * sx - 1.5, e.y / TILE * sy - 1.5, 3, 3);
  }
  if (!G.revealAll) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = y * MAP_W + x;
        if (!G.explored[i]) { ctx.fillStyle = '#000'; ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy)); }
        else if (!G.vis[i]) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy)); }
      }
    }
  }
  // Campaign objectives show through the fog as a pulsing ring.
  const mk = typeof missionMarker === 'function' ? missionMarker() : null;
  if (mk) {
    const pr = 4 + Math.sin(performance.now() / 200) * 1.5;
    ctx.strokeStyle = '#c58cff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc((mk.x + 0.5) * sx, (mk.y + 0.5) * sy, pr + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c58cff';
    ctx.fillRect((mk.x + 0.5) * sx - 2, (mk.y + 0.5) * sy - 2, 4, 4);
  }
  // Gold mines are common knowledge, so they show through the fog.
  for (const e of G.ents) {
    if (e.dead || e.type !== 'mine') continue;
    ctx.fillStyle = '#1a1206';
    ctx.fillRect(e.tx * sx - 1, e.ty * sy - 1, e.w * sx + 2, e.h * sy + 2);
    ctx.fillStyle = '#f1cf4a';
    ctx.fillRect(e.tx * sx, e.ty * sy, e.w * sx, e.h * sy);
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.x / TILE * sx + 0.5, cam.y / TILE * sy + 0.5, vw / TILE * sx, vh / TILE * sy);
}

// ---------- units ----------

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function shadow(ctx, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 10, w, w * 0.35, 0, 0, Math.PI * 2); ctx.fill();
}

function legs(ctx, walk, color, len = 8) {
  const s = Math.sin(walk) * 2.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2, 2); ctx.lineTo(-2 + s, 2 + len);
  ctx.moveTo(2, 2); ctx.lineTo(2 - s, 2 + len);
  ctx.stroke();
}

function torso(ctx, color, w = 10, h = 10) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 3);
  ctx.lineTo(-w / 2 + 1, -h + 3);
  ctx.quadraticCurveTo(0, -h, w / 2 - 1, -h + 3);
  ctx.lineTo(w / 2, 3);
  ctx.closePath();
  ctx.fill();
}

function head(ctx, f, opts = {}) {
  const F = FACTIONS[f];
  const y = opts.y || -10;
  const r = opts.r || 4;
  ctx.fillStyle = F.skin;
  ctx.beginPath(); ctx.arc(0, y, r, 0, Math.PI * 2); ctx.fill();
  // Beard.
  ctx.fillStyle = F.hair;
  ctx.beginPath();
  ctx.moveTo(-r + 0.5, y + 0.5);
  ctx.quadraticCurveTo(0, y + r + 4, r - 0.5, y + 0.5);
  ctx.closePath();
  ctx.fill();
  if (f === 'vikings' && opts.helm !== false) {
    ctx.fillStyle = '#8b9096';
    ctx.beginPath(); ctx.arc(0, y - 0.5, r + 0.6, Math.PI, 0); ctx.fill();
    ctx.fillRect(0.5, y - 1, 1.4, 4);
  } else if (f === 'jotnar') {
    ctx.fillStyle = F.hair;
    ctx.beginPath(); ctx.arc(0, y - 1, r + 0.4, Math.PI * 1.05, -0.05); ctx.fill();
    if (opts.tusks) {
      ctx.strokeStyle = '#f4f1e6';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(2, y + 2); ctx.lineTo(4.5, y - 1); ctx.stroke();
    }
  } else {
    ctx.fillStyle = F.hair;
    ctx.beginPath(); ctx.arc(0, y - 1, r + 0.3, Math.PI, 0); ctx.fill();
  }
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(1.6, y - 1, 1.2, 1.2);
}

function axe(ctx, swing, big) {
  ctx.save();
  ctx.translate(4, -3);
  ctx.rotate(-0.4 + swing * 1.6);
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -12); ctx.stroke();
  ctx.fillStyle = '#c9ced3';
  ctx.beginPath();
  ctx.moveTo(0, -12); ctx.quadraticCurveTo(big ? 8 : 6, -12, big ? 7 : 5, -6); ctx.lineTo(0, -8);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function club(ctx, swing) {
  ctx.save();
  ctx.translate(4, -3);
  ctx.rotate(-0.4 + swing * 1.6);
  ctx.strokeStyle = '#d5e6ee';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -13); ctx.stroke();
  ctx.fillStyle = '#9ec4d6';
  ctx.beginPath(); ctx.arc(0, -13, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function roundShield(ctx, color, x = -4, y = -3, r = 5) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4a3322';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
  ctx.fillStyle = '#c9ced3';
  ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
}

function bow(ctx, draw) {
  ctx.strokeStyle = '#7a5232';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(3, -4, 7, -Math.PI / 2.2, Math.PI / 2.2); ctx.stroke();
  ctx.strokeStyle = '#e8e2d0';
  ctx.lineWidth = 0.7;
  const pull = draw * 4;
  ctx.beginPath(); ctx.moveTo(4.5, -10.5); ctx.lineTo(3 - pull, -4); ctx.lineTo(4.5, 2.5); ctx.stroke();
}

function drawUnitSprite(ctx, type, faction, color, o) {
  // o: {dir, walk, atk (0..1), carry, chop, scale}
  const F = FACTIONS[faction];
  const giant = faction === 'jotnar';
  const swing = o.atk > 0 ? Math.sin((1 - o.atk / 0.3) * Math.PI) : 0;
  ctx.save();
  ctx.scale(o.dir * (o.scale || 1), o.scale || 1);
  if (type === 'worker') {
    shadow(ctx, 7);
    legs(ctx, o.walk, '#4b3a2a');
    torso(ctx, giant ? '#8aa2ad' : '#8a6a44');
    ctx.fillStyle = color; ctx.fillRect(-5, 0, 10, 2);
    head(ctx, faction, { helm: false });
    if (o.carry === 'gold') {
      ctx.fillStyle = '#e8c547';
      ctx.beginPath(); ctx.arc(-6, -4, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8862a'; ctx.fillRect(-7, -9, 2, 2);
    } else if (o.carry === 'wood') {
      ctx.fillStyle = '#7a5232';
      ctx.save(); ctx.rotate(-0.3);
      ctx.fillRect(-9, -11, 14, 3); ctx.fillRect(-8, -8, 14, 3);
      ctx.restore();
    } else {
      const sw = o.chop ? Math.max(0, Math.sin(o.walk * 2)) : swing;
      axe(ctx, sw, false);
    }
  } else if (type === 'melee') {
    shadow(ctx, 8);
    if (giant) {
      ctx.scale(1.15, 1.15);
      legs(ctx, o.walk, '#6f8f9f');
      torso(ctx, '#9ec0cf', 12, 11);
      ctx.fillStyle = color; ctx.fillRect(-6, -2, 12, 3);
      head(ctx, faction, { tusks: true, r: 4.5 });
      club(ctx, swing);
    } else {
      legs(ctx, o.walk, '#3e3326');
      torso(ctx, '#6d7378');
      ctx.fillStyle = color; ctx.fillRect(-5, -4, 10, 3);
      head(ctx, faction);
      axe(ctx, swing, true);
      roundShield(ctx, color);
    }
  } else if (type === 'ranged') {
    shadow(ctx, 7);
    legs(ctx, o.walk, giant ? '#6f8f9f' : '#3e3326');
    torso(ctx, giant ? '#b6d3df' : '#4f6a3e');
    ctx.fillStyle = color; ctx.fillRect(-5, -1, 10, 2);
    head(ctx, faction, { helm: false });
    if (giant) {
      // Ice spear held overhead.
      ctx.save(); ctx.translate(3, -6); ctx.rotate(-0.9 - swing * 0.6);
      ctx.strokeStyle = '#c9e6f2'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -10); ctx.stroke();
      ctx.fillStyle = '#eaf7fc'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(2, -9); ctx.lineTo(-2, -9); ctx.fill();
      ctx.restore();
    } else bow(ctx, swing);
  } else if (type === 'rider') {
    shadow(ctx, 12);
    const bob = Math.sin(o.walk) * 1.2;
    const s = Math.sin(o.walk * 1.3) * 3;
    ctx.strokeStyle = giant ? '#5f6a70' : '#4a3020';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const lx of [-7, -3, 4, 8]) { ctx.moveTo(lx, 2); ctx.lineTo(lx + (lx % 2 ? s : -s), 10); }
    ctx.stroke();
    ctx.fillStyle = giant ? '#8c979d' : '#7a5232';
    ctx.beginPath(); ctx.ellipse(0, 0 + bob, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    // Head and neck.
    ctx.beginPath();
    if (giant) {
      ctx.ellipse(11, -2 + bob, 5, 3.5, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9, -5 + bob); ctx.lineTo(10, -9 + bob); ctx.lineTo(12, -5 + bob); ctx.fill();
      ctx.fillStyle = '#f4f1e6'; ctx.fillRect(14, -1 + bob, 2, 1);
      ctx.fillStyle = '#8c979d';
      ctx.beginPath(); ctx.moveTo(-10, -1 + bob); ctx.quadraticCurveTo(-16, -6 + bob, -15, 1 + bob); ctx.fill();
    } else {
      ctx.moveTo(7, -2 + bob); ctx.lineTo(11, -10 + bob); ctx.lineTo(15, -8 + bob); ctx.lineTo(11, -1 + bob); ctx.fill();
      ctx.fillStyle = '#e8e2d0';
      ctx.fillRect(9, -11 + bob, 2, 6);
    }
    ctx.fillStyle = color;
    ctx.fillRect(-5, -4 + bob, 9, 3);
    ctx.save();
    ctx.translate(0, -6 + bob);
    ctx.scale(0.9, 0.9);
    torso(ctx, giant ? '#9ec0cf' : '#8b9096', 9, 9);
    head(ctx, faction, { r: 3.8 });
    if (!giant) {
      // Valkyrie wings on the helm.
      ctx.fillStyle = '#f2f2ee';
      ctx.beginPath(); ctx.moveTo(-3, -13); ctx.quadraticCurveTo(-9, -19, -7, -11); ctx.fill();
    }
    ctx.save(); ctx.translate(3, -4); ctx.rotate(0.3 + swing * 0.9);
    ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(12, -2); ctx.stroke();
    ctx.fillStyle = '#c9ced3';
    ctx.beginPath(); ctx.moveTo(12, -4); ctx.lineTo(16, -2.5); ctx.lineTo(12, 0); ctx.fill();
    ctx.restore();
    ctx.restore();
  } else if (type === 'siege') {
    if (giant) {
      shadow(ctx, 11);
      ctx.scale(1.55, 1.55);
      legs(ctx, o.walk * 0.7, '#5f666b', 7);
      torso(ctx, '#80888d', 12, 11);
      ctx.fillStyle = color; ctx.fillRect(-6, -1, 12, 2);
      ctx.fillStyle = '#80888d';
      ctx.beginPath(); ctx.arc(0, -10, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c8cfd3';
      ctx.beginPath(); ctx.arc(0, -11, 4.6, Math.PI * 1.05, -0.05); ctx.fill();
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(1.6, -11, 1.2, 1.2);
      // Boulder overhead.
      const lift = o.atk > 0 ? -2 : 0;
      ctx.fillStyle = '#6d6560';
      ctx.beginPath(); ctx.arc(-1, -19 + lift, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a827c';
      ctx.beginPath(); ctx.arc(-2.5, -20.5 + lift, 2.2, 0, Math.PI * 2); ctx.fill();
    } else {
      shadow(ctx, 13);
      ctx.fillStyle = '#5a3e26';
      ctx.fillRect(-12, -2, 22, 6);
      ctx.fillStyle = '#2d2016';
      for (const wx of [-8, 6]) { ctx.beginPath(); ctx.arc(wx, 5, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#8a6a44';
      for (const wx of [-8, 6]) { ctx.beginPath(); ctx.arc(wx, 5, 1.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(12, -8); ctx.stroke();
      ctx.strokeStyle = '#4a3322'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(8, -7, 8, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 0.8;
      const pull = o.atk > 0 ? 0 : 4;
      ctx.beginPath(); ctx.moveTo(8, -15); ctx.lineTo(4 - pull, -7); ctx.lineTo(8, 1); ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(-12, -4, 5, 3);
    }
  } else if (type === 'caster') {
    shadow(ctx, 7);
    // Long robe instead of legs.
    const sway = Math.sin(o.walk) * 1.5;
    ctx.fillStyle = giant ? '#cfe6ef' : '#3c3550';
    ctx.beginPath();
    ctx.moveTo(-5, -7); ctx.lineTo(5, -7); ctx.lineTo(6 + sway, 10); ctx.lineTo(-6 + sway, 10); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color; ctx.fillRect(-5, -1, 10, 2);
    head(ctx, faction, { helm: false, r: 3.8 });
    // Hood or ice crown.
    if (giant) {
      ctx.fillStyle = '#eaf7fc';
      for (const hx of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(hx - 1.5, -13); ctx.lineTo(hx, -18 - (hx === 0 ? 2 : 0)); ctx.lineTo(hx + 1.5, -13); ctx.fill(); }
    } else {
      ctx.fillStyle = '#2a2438';
      ctx.beginPath(); ctx.arc(0, -11, 4.8, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    }
    // Staff with a glowing head.
    const lift = o.atk > 0 ? -3 : 0;
    ctx.strokeStyle = giant ? '#9ec4d6' : '#6b4a2b';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(6, 9); ctx.lineTo(6, -14 + lift); ctx.stroke();
    const glow = giant ? '#9fe8ff' : '#ffd86a';
    ctx.fillStyle = glow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = o.atk > 0 ? 12 : 6;
    ctx.beginPath(); ctx.arc(6, -15 + lift, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  } else if (type === 'hero') {
    if (giant) {
      // Hrungnir: a towering stone-hearted giant with an ice crown and a great club.
      shadow(ctx, 12);
      ctx.scale(1.55, 1.55);
      legs(ctx, o.walk, '#5f7f8f', 8);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, -6); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
      torso(ctx, '#8fb2c2', 12, 12);
      ctx.fillStyle = '#5d6a70';
      ctx.beginPath(); ctx.arc(0, -4, 3, 0, Math.PI * 2); ctx.fill();
      head(ctx, faction, { tusks: true, r: 4.6 });
      ctx.fillStyle = '#d6f6ff';
      for (const hx of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(hx - 1.4, -14); ctx.lineTo(hx, -19 - (hx ? 0 : 2)); ctx.lineTo(hx + 1.4, -14); ctx.fill(); }
      club(ctx, swing);
    } else {
      // Sigrún: winged helm, team-colored cape, sword and a bright shield.
      shadow(ctx, 9);
      ctx.scale(1.25, 1.25);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(4, -7); ctx.lineTo(7, 9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      legs(ctx, o.walk, '#3e3326');
      torso(ctx, '#b9bec4');
      ctx.fillStyle = '#e8c547'; ctx.fillRect(-5, -1, 10, 2);
      head(ctx, faction, { helm: false });
      ctx.fillStyle = '#e8c547';
      ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(4, -12); ctx.lineTo(0, -11); ctx.fill();
      ctx.fillStyle = '#e9b44c';
      ctx.fillRect(-4.5, -11, 1.5, 7);
      ctx.fillStyle = '#c9ced3';
      ctx.beginPath(); ctx.arc(0, -11, 4.6, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#f5f5f0';
      ctx.beginPath(); ctx.moveTo(-4, -13); ctx.quadraticCurveTo(-11, -20, -9, -11); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4, -13); ctx.quadraticCurveTo(11, -20, 9, -11); ctx.fill();
      ctx.save(); ctx.translate(4, -3); ctx.rotate(-0.5 + swing * 1.7);
      ctx.fillStyle = '#e3e7ea'; ctx.fillRect(-1, -15, 2.2, 14);
      ctx.fillStyle = '#e8c547'; ctx.fillRect(-3, -1.5, 6.5, 2);
      ctx.restore();
      roundShield(ctx, '#e8c547', -4, -3, 5.5);
    }
  } else if (type === 'einherjar') {
    // A ghostly huscarl.
    ctx.globalAlpha *= 0.75;
    ctx.fillStyle = 'rgba(150,200,255,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 13, 0, 0, Math.PI * 2); ctx.fill();
    legs(ctx, o.walk, '#7d93b3');
    torso(ctx, '#9fb4cf');
    ctx.fillStyle = color; ctx.fillRect(-5, -4, 10, 3);
    head(ctx, 'vikings');
    axe(ctx, swing, true);
    roundShield(ctx, '#c9d8ea');
  } else if (type === 'wolf') {
    shadow(ctx, 10);
    const s = Math.sin(o.walk * 1.4) * 3;
    ctx.strokeStyle = '#6d7980';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const lx of [-6, -2, 4, 7]) { ctx.moveTo(lx, 2); ctx.lineTo(lx + (lx % 2 ? s : -s), 9); }
    ctx.stroke();
    ctx.fillStyle = '#b9c8cf';
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(10, -3, 5, 3.6, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(9, -10); ctx.lineTo(11, -6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-9, -1); ctx.quadraticCurveTo(-15, -6 - swing * 3, -14, 1); ctx.fill();
    ctx.fillStyle = '#f4f1e6'; ctx.fillRect(13, -1, 2, 1.2);
    ctx.fillStyle = '#5ad0ff'; ctx.fillRect(11, -4.5, 1.4, 1.4);
    ctx.fillStyle = color; ctx.fillRect(5, -4, 3, 6);
  }
  ctx.restore();
  void F;
}

// ---------- buildings ----------

function bpal(faction) {
  return faction === 'jotnar'
    ? { wall: '#8fb9cc', line: '#6a97ad', roof: '#e3f1f7', roof2: '#bfdbe8', trim: '#4d7b92', door: '#1d3a4a', stone: '#8d969b' }
    : { wall: '#6b4a2b', line: '#4f3520', roof: '#6a5a34', roof2: '#5f7a3a', trim: '#3b2a1c', door: '#24170e', stone: '#7d7f82' };
}

function house(ctx, x, y, w, h, P, opts = {}) {
  const wallH = h * (opts.wallFrac || 0.42);
  const wy = y + h - wallH;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + h - 4, w, 6);
  ctx.fillStyle = P.wall;
  ctx.fillRect(x, wy, w, wallH);
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  for (let px = x + 4; px < x + w; px += 5) { ctx.beginPath(); ctx.moveTo(px, wy); ctx.lineTo(px, wy + wallH); ctx.stroke(); }
  // Roof.
  const ov = 3;
  ctx.fillStyle = P.roof;
  ctx.beginPath();
  ctx.moveTo(x - ov, wy + 2);
  ctx.lineTo(x + w * 0.12, y);
  ctx.lineTo(x + w * 0.88, y);
  ctx.lineTo(x + w + ov, wy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = P.roof2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.12, y);
  ctx.lineTo(x + w * 0.88, y);
  ctx.lineTo(x + w * 0.84, y + (wy - y) * 0.35);
  ctx.lineTo(x + w * 0.16, y + (wy - y) * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  for (let i = 1; i < 4; i++) {
    const yy = y + (wy - y) * i / 4;
    ctx.beginPath(); ctx.moveTo(x + w * 0.12 * (1 - i / 4) - ov * i / 4, yy); ctx.lineTo(x + w - w * 0.12 * (1 - i / 4) + ov * i / 4, yy); ctx.stroke();
  }
  if (opts.icicles) {
    ctx.fillStyle = '#f4fbfe';
    for (let px = x; px < x + w; px += 5) {
      ctx.beginPath(); ctx.moveTo(px, wy + 2); ctx.lineTo(px + 3, wy + 2); ctx.lineTo(px + 1.5, wy + 6 + (px % 3)); ctx.fill();
    }
  }
  // Door.
  const dw = opts.doorW || Math.max(8, w * 0.16);
  ctx.fillStyle = P.door;
  ctx.fillRect(x + w / 2 - dw / 2, y + h - wallH * 0.7, dw, wallH * 0.7);
  ctx.strokeStyle = P.trim;
  ctx.strokeRect(x + w / 2 - dw / 2, y + h - wallH * 0.7, dw, wallH * 0.7);
  return { wy, wallH };
}

function dragonHead(ctx, x, y, dir) {
  ctx.strokeStyle = '#3b2a1c';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  ctx.quadraticCurveTo(x + dir * 2, y - 6, x + dir * 7, y - 5);
  ctx.stroke();
}

function banner(ctx, x, y, color) {
  ctx.strokeStyle = '#3b2a1c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 10, y - 15); ctx.lineTo(x, y - 11); ctx.fill();
}

function mound(ctx, x, y, w, h, base, top) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + w / 2 + 3, y + h - 3, w / 2, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(x, y + h - 4);
  ctx.quadraticCurveTo(x + 2, y + h * 0.2, x + w * 0.5, y + 4);
  ctx.quadraticCurveTo(x + w - 2, y + h * 0.2, x + w, y + h - 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h * 0.35);
  ctx.quadraticCurveTo(x + w * 0.5, y - 2, x + w * 0.8, y + h * 0.35);
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.2, x + w * 0.2, y + h * 0.35);
  ctx.fill();
}

function drawBuildingArt(ctx, type, faction, color, w, h) {
  const P = bpal(faction);
  const ice = faction === 'jotnar';
  const W = w * TILE, H = h * TILE;
  switch (type) {
    case 'hall': {
      if (ice) {
        house(ctx, 6, 14, W - 12, H - 18, P, { icicles: true, wallFrac: 0.5 });
        ctx.fillStyle = '#eaf7fc';
        for (const sx of [14, 34, 54, 74]) { ctx.beginPath(); ctx.moveTo(sx, 18); ctx.lineTo(sx + 5, 2); ctx.lineTo(sx + 10, 18); ctx.fill(); }
      } else {
        house(ctx, 6, 16, W - 12, H - 20, P, { wallFrac: 0.45 });
        dragonHead(ctx, 16, 16, -1);
        dragonHead(ctx, W - 16, 16, 1);
      }
      for (const sx of [16, W - 22]) roundShield(ctx, color, sx + 3, H - 22, 5);
      banner(ctx, W - 10, H - 30, color);
      break;
    }
    case 'farm': {
      // Fenced field with a small hut.
      ctx.fillStyle = ice ? '#c7d9e2' : '#6e5a35';
      ctx.fillRect(4, H * 0.5, W - 8, H * 0.46);
      ctx.strokeStyle = ice ? '#a9c1cd' : '#8b7748';
      for (let fy = H * 0.5 + 4; fy < H - 4; fy += 5) { ctx.beginPath(); ctx.moveTo(6, fy); ctx.lineTo(W - 6, fy); ctx.stroke(); }
      ctx.strokeStyle = '#4a3322'; ctx.lineWidth = 1.5;
      ctx.strokeRect(3, H * 0.5, W - 6, H * 0.47);
      house(ctx, 6, 4, W * 0.62, H * 0.5, P, { icicles: ice });
      banner(ctx, W - 10, H * 0.5, color);
      break;
    }
    case 'barracks': {
      if (ice) {
        mound(ctx, 2, 4, W - 4, H - 4, '#7f8a90', '#e6f1f5');
        ctx.fillStyle = '#1d2a33';
        ctx.beginPath(); ctx.ellipse(W / 2, H - 14, 13, 13, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(W / 2 - 13, H - 14, 26, 8);
        ctx.strokeStyle = '#f4f1e6'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(W / 2 - 16, H - 6); ctx.quadraticCurveTo(W / 2 - 20, H - 26, W / 2 - 8, H - 32); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W / 2 + 16, H - 6); ctx.quadraticCurveTo(W / 2 + 20, H - 26, W / 2 + 8, H - 32); ctx.stroke();
      } else {
        const r = house(ctx, 4, 10, W - 8, H - 14, P, { wallFrac: 0.48, doorW: 14 });
        for (let sx = 10; sx < W - 16; sx += 14) if (Math.abs(sx + 5 - W / 2) > 10) roundShield(ctx, color, sx + 5, r.wy + 9, 5);
        dragonHead(ctx, 14, 10, -1);
        dragonHead(ctx, W - 14, 10, 1);
      }
      banner(ctx, 8, H - 6, color);
      break;
    }
    case 'mill': {
      house(ctx, 4, 6, W - 22, H - 16, P, { icicles: ice });
      // Log or ice-block pile.
      ctx.fillStyle = ice ? '#cfe9f4' : '#7a5232';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) {
        if (ice) ctx.fillRect(W - 20 + j * 6 + i * 3, H - 10 - i * 5, 5, 5);
        else { ctx.beginPath(); ctx.arc(W - 16 + j * 5 + i * 2.5, H - 8 - i * 4.5, 2.6, 0, Math.PI * 2); ctx.fill(); }
      }
      banner(ctx, 8, H - 8, color);
      break;
    }
    case 'stable': {
      if (ice) {
        mound(ctx, 2, 8, W - 4, H - 8, '#6f777c', '#e6f1f5');
        ctx.fillStyle = '#1d2a33';
        ctx.beginPath(); ctx.ellipse(W / 2, H - 10, 9, 9, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#f4f1e6';
        ctx.fillRect(8, H - 8, 8, 2); ctx.fillRect(W - 16, H - 10, 7, 2);
      } else {
        house(ctx, 2, 6, W - 4, H - 10, P, { doorW: 16 });
        ctx.fillStyle = '#d8b850';
        ctx.fillRect(W - 14, H - 10, 10, 6);
      }
      banner(ctx, W - 8, H - 14, color);
      break;
    }
    case 'forge': {
      ctx.fillStyle = P.stone;
      ctx.fillRect(4, H * 0.45, W - 8, H * 0.5);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let yy = H * 0.45 + 5; yy < H - 4; yy += 6) { ctx.beginPath(); ctx.moveTo(4, yy); ctx.lineTo(W - 4, yy); ctx.stroke(); }
      house(ctx, 4, 4, W - 8, H * 0.55, { ...P, wall: P.stone, line: '#666' }, { icicles: ice });
      ctx.fillStyle = '#4b4f54'; ctx.fillRect(W - 18, 0, 8, 16);
      ctx.fillStyle = ice ? '#7fe3ff' : '#ff8a2a';
      ctx.fillRect(10, H - 16, 10, 8);
      ctx.fillStyle = '#2b2d30';
      ctx.fillRect(W - 24, H - 12, 12, 4); ctx.fillRect(W - 21, H - 8, 6, 5);
      banner(ctx, 6, H - 4, color);
      break;
    }
    case 'tower': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(W / 2 + 3, H - 4, W * 0.35, 6, 0, 0, Math.PI * 2); ctx.fill();
      if (ice) {
        ctx.fillStyle = '#9fd2e6';
        ctx.beginPath(); ctx.moveTo(W / 2 - 14, H - 4); ctx.lineTo(W / 2 - 6, -14); ctx.lineTo(W / 2 + 2, H - 4); ctx.fill();
        ctx.fillStyle = '#d6f0fa';
        ctx.beginPath(); ctx.moveTo(W / 2 - 4, H - 4); ctx.lineTo(W / 2 + 4, -22); ctx.lineTo(W / 2 + 14, H - 4); ctx.fill();
        ctx.fillStyle = '#7dbbd4';
        ctx.beginPath(); ctx.moveTo(W / 2 + 6, H - 4); ctx.lineTo(W / 2 + 13, 6); ctx.lineTo(W / 2 + 18, H - 4); ctx.fill();
      } else {
        ctx.strokeStyle = '#4f3520'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 14, H - 4); ctx.lineTo(W / 2 - 9, 0);
        ctx.moveTo(W / 2 + 14, H - 4); ctx.lineTo(W / 2 + 9, 0);
        ctx.moveTo(W / 2 - 13, H - 10); ctx.lineTo(W / 2 + 11, 10);
        ctx.moveTo(W / 2 + 13, H - 10); ctx.lineTo(W / 2 - 11, 10);
        ctx.stroke();
        ctx.fillStyle = P.wall; ctx.fillRect(W / 2 - 13, -6, 26, 10);
        ctx.fillStyle = P.roof;
        ctx.beginPath(); ctx.moveTo(W / 2 - 16, -6); ctx.lineTo(W / 2, -20); ctx.lineTo(W / 2 + 16, -6); ctx.fill();
      }
      banner(ctx, W / 2 + 2, ice ? -16 : -18, color);
      break;
    }
    case 'temple': {
      if (ice) {
        // Standing stones around a glowing ice altar.
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(W / 2 + 2, H - 8, W * 0.45, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c9e4ee';
        ctx.beginPath(); ctx.ellipse(W / 2, H - 14, W * 0.42, 12, 0, 0, Math.PI * 2); ctx.fill();
        for (const [sx, sy, sh] of [[8, H - 16, 22], [W - 14, H - 16, 22], [14, H - 26, 18], [W - 20, H - 26, 18]]) {
          ctx.fillStyle = '#8d969b'; ctx.fillRect(sx, sy - sh, 7, sh);
          ctx.fillStyle = '#e6f1f5'; ctx.fillRect(sx, sy - sh, 7, 3);
        }
        ctx.fillStyle = '#7dbbd4';
        ctx.beginPath(); ctx.moveTo(W / 2 - 8, H - 12); ctx.lineTo(W / 2, H - 46); ctx.lineTo(W / 2 + 8, H - 12); ctx.fill();
        ctx.fillStyle = '#d6f6ff';
        ctx.beginPath(); ctx.moveTo(W / 2 - 3, H - 14); ctx.lineTo(W / 2, H - 40); ctx.lineTo(W / 2 + 3, H - 14); ctx.fill();
      } else {
        // A small stave hof with stacked roofs.
        house(ctx, 6, 22, W - 12, H - 24, P, { wallFrac: 0.5 });
        ctx.fillStyle = P.roof;
        ctx.beginPath(); ctx.moveTo(14, 26); ctx.lineTo(W / 2, 4); ctx.lineTo(W - 14, 26); ctx.fill();
        ctx.fillStyle = P.roof2;
        ctx.beginPath(); ctx.moveTo(W / 2 - 8, 12); ctx.lineTo(W / 2, -6); ctx.lineTo(W / 2 + 8, 12); ctx.fill();
        dragonHead(ctx, 16, 24, -1);
        dragonHead(ctx, W - 16, 24, 1);
        ctx.fillStyle = '#ffd86a';
        ctx.fillRect(W / 2 - 2, 30, 4, 4);
      }
      banner(ctx, W - 6, H - 4, color);
      break;
    }
    case 'mine': {
      mound(ctx, 2, 6, W - 4, H - 6, '#6e655c', '#8a7f74');
      ctx.fillStyle = '#18120c';
      ctx.beginPath(); ctx.ellipse(W / 2, H - 14, 12, 12, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(W / 2 - 12, H - 14, 24, 9);
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W / 2 - 13, H - 4); ctx.lineTo(W / 2 - 13, H - 26); ctx.lineTo(W / 2 + 13, H - 26); ctx.lineTo(W / 2 + 13, H - 4); ctx.stroke();
      ctx.fillStyle = '#f1cf4a';
      for (const [gx, gy] of [[18, 30], [70, 34], [60, 20], [28, 46], [76, 52], [40, 22]]) {
        ctx.beginPath(); ctx.moveTo(gx, gy - 3); ctx.lineTo(gx + 2, gy); ctx.lineTo(gx, gy + 3); ctx.lineTo(gx - 2, gy); ctx.fill();
      }
      ctx.fillStyle = '#e6eef1';
      ctx.beginPath(); ctx.ellipse(W / 2, 14, 20, 6, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }
}

function buildingImage(type, faction, color) {
  const key = type + '|' + faction + '|' + color;
  let c = R.bcache.get(key);
  if (c) return c;
  const d = BUILDINGS[type];
  c = document.createElement('canvas');
  const pad = 26;
  c.width = d.w * TILE + pad * 2;
  c.height = d.h * TILE + pad * 2;
  const ctx = c.getContext('2d');
  ctx.translate(pad, pad);
  drawBuildingArt(ctx, type, faction, color, d.w, d.h);
  c.pad = pad;
  R.bcache.set(key, c);
  return c;
}

function drawConstruction(ctx, b, faction) {
  const x = b.tx * TILE, y = b.ty * TILE, W = b.w * TILE, H = b.h * TILE;
  ctx.fillStyle = 'rgba(70,50,30,0.6)';
  ctx.fillRect(x + 2, y + 2, W - 4, H - 4);
  if (b.progress > 0.25) {
    const img = buildingImage(b.type, faction, G.players[b.owner].color);
    const vis = Math.min(1, (b.progress - 0.25) / 0.75);
    const sh = img.height * vis;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, 0, img.height - sh, img.width, sh, x - img.pad, y - img.pad + img.height - sh, img.width, sh);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#a07a4a';
  ctx.lineWidth = 2;
  for (let i = 0; i <= b.w; i++) { ctx.beginPath(); ctx.moveTo(x + i * W / b.w, y + 2); ctx.lineTo(x + i * W / b.w, y + H - 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x, y + H / 2); ctx.lineTo(x + W, y + H / 2); ctx.stroke();
}

// ---------- world ----------

function drawBuilding(ctx, b) {
  const faction = b.owner >= 0 ? G.players[b.owner].faction : 'vikings';
  const color = b.owner >= 0 ? G.players[b.owner].color : '#e8c547';
  if (!b.built) return drawConstruction(ctx, b, faction);
  const img = buildingImage(b.type, faction, color);
  ctx.drawImage(img, b.tx * TILE - img.pad, b.ty * TILE - img.pad);
  if (b.hitT > 0) {
    ctx.fillStyle = 'rgba(255,80,60,0.25)';
    ctx.fillRect(b.tx * TILE, b.ty * TILE, b.w * TILE, b.h * TILE);
  }
  // Fire and smoke as it takes damage.
  const frac = b.hp / b.maxHp;
  if (b.type !== 'mine' && frac < 0.6) {
    const n = frac < 0.3 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const fx = b.tx * TILE + (0.25 + 0.5 * hash2(b.id, i, 3)) * b.w * TILE;
      const fy = b.ty * TILE + (0.3 + 0.4 * hash2(b.id, i, 4)) * b.h * TILE;
      const fl = Math.sin(G.time * 12 + i * 2) * 2;
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.moveTo(fx - 5, fy); ctx.quadraticCurveTo(fx, fy - 14 - fl, fx + 5, fy); ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.moveTo(fx - 2.5, fy); ctx.quadraticCurveTo(fx, fy - 8 - fl, fx + 2.5, fy); ctx.fill();
      ctx.fillStyle = 'rgba(60,60,60,0.35)';
      const sy = (G.time * 20 + i * 13) % 26;
      ctx.beginPath(); ctx.arc(fx + sy * 0.3, fy - 14 - sy, 4 + sy * 0.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (b.type === 'forge' && b.queue.length) {
    const sy = (G.time * 18) % 20;
    ctx.fillStyle = 'rgba(80,80,80,0.4)';
    ctx.beginPath(); ctx.arc(b.tx * TILE + b.w * TILE - 14, b.ty * TILE - sy, 3 + sy * 0.2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawUnit(ctx, u) {
  const p = G.players[u.owner];
  ctx.save();
  ctx.translate(Math.round(u.x), Math.round(u.y));
  const moving = u.path && u.pathI < u.path.length;
  if (u.life != null && u.life < 6) ctx.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(G.time * 8));
  drawUnitSprite(ctx, u.type, p.faction, p.color, {
    dir: u.facing, walk: moving ? u.anim : 0, atk: u.atkAnim > 0 ? u.atkAnim : 0,
    carry: u.carry ? u.carry.res : null, chop: u.chopping, scale: 1,
  });
  ctx.restore();
}

function drawArea(ctx, a) {
  if (a.kind === 'storm') {
    const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.r);
    g.addColorStop(0, 'rgba(40,45,70,0.45)');
    g.addColorStop(1, 'rgba(40,45,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(225,240,250,0.28)';
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 40; i++) {
      const ang = hash2(i, 1, 5) * Math.PI * 2 + a.age * (1.5 + hash2(i, 2, 5));
      const rr = hash2(i, 3, 5) * a.r;
      const fall = (a.age * 60 + hash2(i, 4, 5) * 40) % 40;
      ctx.fillRect(a.x + Math.cos(ang) * rr, a.y + Math.sin(ang) * rr * 0.6 - 20 + fall, 2, 2);
    }
  }
}

function drawHpBar(ctx, x, y, w, frac) {
  ctx.fillStyle = '#111';
  ctx.fillRect(x - 1, y - 1, w + 2, 5);
  ctx.fillStyle = frac > 0.6 ? '#4ccf4c' : frac > 0.3 ? '#e2c23a' : '#e2463a';
  ctx.fillRect(x, y, w * Math.max(0, frac), 3);
}

function drawSelection(ctx, e, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  if (e.kind === 'bldg') {
    ctx.strokeRect(e.tx * TILE + 1, e.ty * TILE + 1, e.w * TILE - 2, e.h * TILE - 2);
  } else {
    const big = e.type === 'rider' || e.type === 'siege' || e.type === 'hero';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + 9, big ? 14 : 10, big ? 6 : 4.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawProjectile(ctx, pr) {
  if (pr.kind === 'magic') {
    const c = pr.faction === 'jotnar' ? '#9fe8ff' : '#ffd86a';
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }
  if (pr.kind === 'arrow') {
    const a = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
    ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
    ctx.strokeStyle = pr.faction === 'jotnar' ? '#d6f0fa' : '#e8dcc0';
    ctx.lineWidth = pr.faction === 'jotnar' ? 2 : 1.3;
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(4, 0); ctx.stroke();
    ctx.restore();
  } else {
    // Lobbed: arc above the straight line.
    const total = Math.hypot(pr.tx - pr.sx, pr.ty - pr.sy) || 1;
    const done = 1 - Math.hypot(pr.tx - pr.x, pr.ty - pr.y) / total;
    const lift = Math.sin(done * Math.PI) * Math.min(60, total * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 8, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    if (pr.faction === 'jotnar') {
      ctx.fillStyle = '#6d6560';
      ctx.beginPath(); ctx.arc(pr.x, pr.y - lift, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      const a = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
      ctx.save(); ctx.translate(pr.x, pr.y - lift); ctx.rotate(a);
      ctx.strokeStyle = '#5a3e26'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(7, 0); ctx.stroke();
      ctx.fillStyle = '#c9ced3';
      ctx.beginPath(); ctx.moveTo(7, -2.5); ctx.lineTo(11, 0); ctx.lineTo(7, 2.5); ctx.fill();
      ctx.restore();
    }
  }
}

function drawEffect(ctx, fx, layer) {
  if (layer === 0) {
    if (fx.type === 'corpse') {
      ctx.globalAlpha = Math.min(1, fx.t / 3);
      ctx.fillStyle = '#5a1a14';
      ctx.beginPath(); ctx.ellipse(fx.x, fx.y + 6, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = fx.color;
      ctx.fillRect(fx.x - 6, fx.y + 3, 10, 3);
      ctx.fillStyle = '#d9d4c8';
      ctx.beginPath(); ctx.arc(fx.x + 6, fx.y + 4, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (fx.type === 'rubble') {
      ctx.globalAlpha = Math.min(1, fx.t / 5);
      for (let i = 0; i < fx.w * fx.h * 3; i++) {
        const rx = fx.x + (hash2(i, fx.x | 0, 1) - 0.5) * fx.w * TILE * 0.9;
        const ry = fx.y + (hash2(i, fx.y | 0, 2) - 0.5) * fx.h * TILE * 0.9;
        ctx.fillStyle = i % 2 ? '#3b2f25' : '#5c5249';
        ctx.beginPath(); ctx.arc(rx, ry, 3 + hash2(i, 3, 3) * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (fx.type === 'blood') {
      ctx.fillStyle = `rgba(150,20,20,${fx.t * 1.5})`;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 2, 0, Math.PI * 2); ctx.fill();
    }
  } else if (fx.type === 'boom') {
    const k = 1 - fx.t / 0.8;
    ctx.fillStyle = `rgba(255,${150 - k * 100},40,${Math.max(0, 0.7 - k)})`;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r * (0.4 + k * 0.8), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(90,90,90,${Math.max(0, 0.5 - k * 0.5)})`;
    ctx.beginPath(); ctx.arc(fx.x, fx.y - k * 20, fx.r * 0.6, 0, Math.PI * 2); ctx.fill();
  } else if (fx.type === 'levelup') {
    const k = 1 - fx.t / 1.2;
    ctx.fillStyle = `rgba(255,220,110,${0.45 * (1 - k)})`;
    ctx.fillRect(fx.x - 9, fx.y - 60 * k - 20, 18, 30 + 60 * k);
    ctx.fillStyle = `rgba(255,236,160,${1 - k})`;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL UP', fx.x, fx.y - 34 - k * 18);
  } else if (fx.type === 'warcry') {
    const k = 1 - fx.t / 0.9;
    ctx.strokeStyle = `rgba(255,210,90,${1 - k})`;
    ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y + 6, HERO_AURA_RANGE * TILE * k, HERO_AURA_RANGE * TILE * k * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (fx.type === 'quake') {
    const k = 1 - fx.t / 0.8;
    ctx.strokeStyle = `rgba(140,110,80,${1 - k})`;
    ctx.lineWidth = 6 * (1 - k) + 1;
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y + 8, 2.2 * TILE * k + 6, (2.2 * TILE * k + 6) * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(120,100,80,${0.5 * (1 - k)})`;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * 50 * k, fx.y + 8 + Math.sin(a) * 28 * k - 10 * Math.sin(k * Math.PI), 4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (fx.type === 'heal') {
    const k = 1 - fx.t;
    const c = fx.faction === 'jotnar' ? '159,232,255' : '255,226,120';
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + k * 3;
      ctx.fillStyle = `rgba(${c},${1 - k})`;
      ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * 9, fx.y - k * 24 + Math.sin(a) * 4, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = `rgba(120,240,140,${1 - k})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx.x - 4, fx.y - 14 - k * 10); ctx.lineTo(fx.x + 4, fx.y - 14 - k * 10);
    ctx.moveTo(fx.x, fx.y - 18 - k * 10); ctx.lineTo(fx.x, fx.y - 10 - k * 10); ctx.stroke();
  } else if (fx.type === 'summon') {
    const k = 1 - fx.t / 0.9;
    const c = fx.faction === 'jotnar' ? '159,232,255' : '200,220,255';
    ctx.fillStyle = `rgba(${c},${0.6 * (1 - k)})`;
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y + 6, 6 + k * 14, 3 + k * 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(fx.x - 3 + k * 2, fx.y - 40 * (1 - k), 6 - k * 4, 46 * (1 - k));
  } else if (fx.type === 'poof') {
    const k = 1 - fx.t / 0.8;
    ctx.fillStyle = `rgba(200,215,230,${0.6 * (1 - k)})`;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(fx.x + (i - 1.5) * 5, fx.y - k * 16 - i * 2, 4 + k * 5, 0, Math.PI * 2); ctx.fill();
    }
  } else if (fx.type === 'bolt') {
    const k = fx.t / 0.25;
    ctx.strokeStyle = `rgba(255,250,200,${k})`;
    ctx.shadowColor = '#bfe0ff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let bx = fx.x, by = fx.y - 160;
    ctx.moveTo(bx, by);
    for (let i = 1; i <= 8; i++) {
      bx = fx.x + (hash2(i, fx.seed | 0, 9) - 0.5) * 22 * (1 - i / 8);
      by = fx.y - 160 + i * 20;
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255,250,200,${k * 0.5})`;
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  } else if (fx.type === 'marker') {
    const k = fx.t / 0.6;
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y, 10 * k + 2, 5 * k + 1, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

function render(ctx, cam, vw, vh, ui) {
  redrawDirtyTerrain();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);
  ctx.drawImage(R.terrain, cam.x, cam.y, vw, vh, 0, 0, vw, vh);
  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  const x0 = cam.x - 96, y0 = cam.y - 96, x1 = cam.x + vw + 96, y1 = cam.y + vh + 96;
  const inView = e => e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1;

  for (const fx of G.effects) if (inView(fx) && tileVisible(fx.x, fx.y)) drawEffect(ctx, fx, 0);

  const list = G.ents.filter(e => !e.dead && !e.hidden && inView(e) && isVisibleEnt(e));
  list.sort((a, b) => (a.kind === 'bldg' ? (a.ty + a.h) * TILE - 1 : a.y + 8) - (b.kind === 'bldg' ? (b.ty + b.h) * TILE - 1 : b.y + 8));
  const sel = ui.selected;
  for (const e of list) {
    if (e.type === 'hero') {
      // Heroes stand in a faint golden glow, and buffed units shimmer.
      ctx.fillStyle = 'rgba(255,215,110,0.18)';
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 9, 18, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (e.buffT > 0) {
      ctx.strokeStyle = 'rgba(255,200,80,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 9, 11, 5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (sel.has(e)) drawSelection(ctx, e, e.owner === G.human ? '#5cf05c' : e.owner < 0 ? '#e8d050' : '#ff5040');
    if (e.kind === 'bldg') drawBuilding(ctx, e);
    else drawUnit(ctx, e);
  }
  for (const pr of G.projectiles) if (inView(pr)) drawProjectile(ctx, pr);
  for (const a of G.areas) if (inView(a) && tileVisible(a.x, a.y)) drawArea(ctx, a);
  for (const fx of G.effects) if (inView(fx)) drawEffect(ctx, fx, 1);

  // Fog of war.
  if (!G.revealAll) {
    const tx0 = Math.max(0, Math.floor(cam.x / TILE)), ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(MAP_W - 1, Math.floor((cam.x + vw) / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor((cam.y + vh) / TILE));
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const i = y * MAP_W + x;
        if (!G.explored[i]) { ctx.fillStyle = '#000'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
        else if (!G.vis[i]) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
      }
    }
  }

  // Health bars.
  for (const e of list) {
    if (e.type === 'mine') {
      if (sel.has(e)) { ctx.fillStyle = '#f1cf4a'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(e.gold + ' gold', e.x, e.ty * TILE - 4); }
      continue;
    }
    const show = sel.has(e) || e.hp < e.maxHp || ui.hover === e;
    if (!show) continue;
    if (e.kind === 'bldg') {
      drawHpBar(ctx, e.tx * TILE + 4, e.ty * TILE - 6, e.w * TILE - 8, e.hp / e.maxHp);
      if (!e.built) {
        ctx.fillStyle = '#111'; ctx.fillRect(e.tx * TILE + 3, e.ty * TILE + e.h * TILE - 7, e.w * TILE - 6, 5);
        ctx.fillStyle = '#e8c547'; ctx.fillRect(e.tx * TILE + 4, e.ty * TILE + e.h * TILE - 6, (e.w * TILE - 8) * e.progress, 3);
      }
    } else {
      if (e.type === 'hero') {
        drawHpBar(ctx, e.x - 14, e.y - 36, 28, e.hp / e.maxHp);
        ctx.fillStyle = '#ffd86a';
        for (let i = 0; i < (e.level || 1); i++) ctx.fillRect(e.x - 13 + i * 6, e.y - 42, 4, 4);
      } else drawHpBar(ctx, e.x - 10, e.y - 26, 20, e.hp / e.maxHp);
      if (e.stunT > 0) {
        ctx.fillStyle = '#ffe680';
        for (let i = 0; i < 3; i++) {
          const a = G.time * 6 + i * 2.1;
          ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 8, e.y - 20 + Math.sin(a) * 3, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (e.mana != null && (sel.has(e) || e.owner === G.human)) {
        ctx.fillStyle = '#111'; ctx.fillRect(e.x - 11, e.y - 22, 22, 4);
        ctx.fillStyle = '#4a8cff'; ctx.fillRect(e.x - 10, e.y - 21, 20 * e.mana / UNITS[e.type].mana, 2);
      }
    }
  }

  // Rally point of a selected own building.
  if (sel.size === 1) {
    const b = [...sel][0];
    if (b.kind === 'bldg' && b.owner === G.human && b.rally) {
      const rx = b.rally.x * TILE + 16, ry = b.rally.y * TILE + 16;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.setLineDash([]);
      banner(ctx, rx, ry + 8, G.players[b.owner].color);
    }
  }

  // Placement ghost.
  if (ui.placing && ui.mouseWorld) {
    const d = BUILDINGS[ui.placing];
    const tx = Math.floor(ui.mouseWorld.x / TILE - d.w / 2 + 0.5), ty = Math.floor(ui.mouseWorld.y / TILE - d.h / 2 + 0.5);
    const ok = canPlace(ui.placing, tx, ty, G.human, ui.placer);
    const p = humanPlayer();
    ctx.globalAlpha = 0.6;
    const img = buildingImage(ui.placing, p.faction, p.color);
    ctx.drawImage(img, tx * TILE - img.pad, ty * TILE - img.pad);
    ctx.globalAlpha = 1;
    for (let y = ty; y < ty + d.h; y++) {
      for (let x = tx; x < tx + d.w; x++) {
        const good = G.map.isWalkable(x, y) && (G.explored[G.map.idx(x, y)] || G.revealAll);
        ctx.fillStyle = good && ok ? 'rgba(80,240,80,0.25)' : 'rgba(255,60,40,0.35)';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }
  ctx.restore();

  // Drag box.
  if (ui.drag && ui.drag.active) {
    // The drag box is in screen pixels; undo the zoom.
    const z = ui.zoom || 1;
    const d = { x0: ui.drag.x0 / z, y0: ui.drag.y0 / z, x1: ui.drag.x1 / z, y1: ui.drag.y1 / z };
    ctx.strokeStyle = '#5cf05c';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    ctx.fillStyle = 'rgba(92,240,92,0.08)';
    ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
  }
}


// Small portrait/icon renderer used by the UI.
function drawIcon(canvas, kind, type, faction, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3a4650');
  g.addColorStop(1, '#1d242a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (kind === 'unit') {
    ctx.save();
    const s = W / 30 * (type === 'siege' ? 0.75 : type === 'rider' ? 0.9 : type === 'hero' ? (faction === 'jotnar' ? 0.62 : 0.85) : 1.1);
    ctx.translate(W / 2, H * (type === 'siege' ? 0.62 : type === 'hero' ? 0.66 : 0.55));
    drawUnitSprite(ctx, type, faction, color, { dir: 1, walk: 0, atk: 0, scale: s });
    ctx.restore();
  } else if (kind === 'bldg') {
    const img = buildingImage(type, faction, color);
    const d = BUILDINGS[type];
    const full = Math.max(d.w, d.h) * TILE + 30;
    const s = W / full;
    ctx.save();
    ctx.translate(W / 2 - d.w * TILE * s / 2, H / 2 - d.h * TILE * s / 2 + 3);
    ctx.scale(s, s);
    ctx.drawImage(img, -img.pad, -img.pad);
    ctx.restore();
  }
}
