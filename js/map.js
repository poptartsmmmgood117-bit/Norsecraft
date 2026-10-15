'use strict';
// Seeded random numbers, value noise and procedural map generation.

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function fbm(x, y, seed) {
  return valueNoise(x, y, seed) * 0.6 + valueNoise(x * 2.1, y * 2.1, seed + 7) * 0.3 + valueNoise(x * 4.3, y * 4.3, seed + 13) * 0.1;
}

class GameMap {
  constructor(seed) {
    this.w = MAP_W;
    this.h = MAP_H;
    this.seed = seed;
    this.tiles = new Uint8Array(MAP_W * MAP_H);
    this.wood = new Uint8Array(MAP_W * MAP_H);
    this.bldg = new Int32Array(MAP_W * MAP_H); // building id occupying tile, 0 if none
    this.dirty = []; // tiles changed since last terrain redraw
    this.starts = [];
    this.mines = [];
    this.generate();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tile(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.ROCK; }
  isGround(x, y) {
    const t = this.tile(x, y);
    return t === T.GRASS || t === T.SNOW || t === T.STUMP;
  }
  isWalkable(x, y) {
    return this.isGround(x, y) && this.bldg[this.idx(x, y)] === 0;
  }
  isForest(x, y) { return this.tile(x, y) === T.FOREST; }

  setTile(x, y, t) {
    const i = this.idx(x, y);
    this.tiles[i] = t;
    this.wood[i] = t === T.FOREST ? WOOD_PER_TREE : 0;
    this.dirty.push(i);
  }

  chop(x, y, amt) {
    const i = this.idx(x, y);
    if (this.tiles[i] !== T.FOREST) return 0;
    const got = Math.min(amt, this.wood[i]);
    this.wood[i] -= got;
    if (this.wood[i] <= 0) {
      this.tiles[i] = T.STUMP;
      this.dirty.push(i);
    }
    return got;
  }

  generate() {
    const W = this.w, H = this.h, seed = this.seed;
    const rng = makeRng(seed);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const f = fbm(x / 7, y / 7, seed + 1);
        const w = fbm(x / 11, y / 11, seed + 2);
        const r = fbm(x / 5, y / 5, seed + 3);
        const s = fbm(x / 9, y / 9, seed + 4);
        let t = s > 0.55 ? T.SNOW : T.GRASS;
        if (w > 0.7) t = T.WATER;
        else if (r > 0.74) t = T.ROCK;
        else if (f > 0.58) t = T.FOREST;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) t = rng() < 0.5 ? T.FOREST : T.ROCK;
        this.tiles[this.idx(x, y)] = t;
      }
    }

    const P = { x: 9, y: 9 };
    const E = { x: W - 10, y: H - 10 };

    // Only the top half survives the mirror step below, so every road is laid
    // out to meet its own reflection on the middle rows.
    const M = { x: 18 + Math.floor(rng() * 10), y: 22 + Math.floor(rng() * 6) };
    this.carveLine(P.x, P.y, M.x, M.y, 1, T.GRASS);
    this.carveLine(M.x, M.y, W - 1 - M.x, H - 1 - M.y, 1, T.GRASS);
    this.carveLine(P.x, P.y, W - 12, 10, 1, T.SNOW);
    this.carveLine(W - 12, 10, W - 11, H / 2, 1, T.SNOW);
    this.carveLine(P.x, P.y, 10, H / 2, 1, T.SNOW);
    this.carveLine(M.x, M.y, W / 2 + 11, H / 2 - 10, 1, T.GRASS);

    // Base clearings with a forest edge.
    this.clearArea(P.x - 6, P.y - 6, 13, 13);
    this.blob(P.x + 9, P.y - 3, 4, T.FOREST, rng);
    this.blob(P.x - 3, P.y + 9, 4, T.FOREST, rng);
    this.clearArea(E.x - 6, E.y - 6, 13, 13);

    // Middle expansions.
    this.clearArea(W / 2 - 15, H / 2 + 6, 7, 7);
    this.clearArea(W / 2 + 8, H / 2 - 13, 7, 7);

    // Mirror the map through the center for fairness.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = this.idx(x, y);
        const j = this.idx(W - 1 - x, H - 1 - y);
        if (i > j) this.tiles[i] = this.tiles[j];
      }
    }

    for (let i = 0; i < W * H; i++) this.wood[i] = this.tiles[i] === T.FOREST ? WOOD_PER_TREE : 0;

    this.starts = [{ x: P.x - 1, y: P.y - 1 }, { x: E.x - 1, y: E.y - 1 }];
    this.mines = [
      { x: P.x + 3, y: P.y + 3 },
      { x: E.x - 5, y: E.y - 5 },
      { x: W / 2 - 13, y: H / 2 + 8 },
      { x: W / 2 + 10, y: H / 2 - 11 },
    ];
    this.dirty.length = 0;
  }

  clearArea(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x <= 0 || y <= 0 || x >= this.w - 1 || y >= this.h - 1) continue;
        const i = this.idx(x, y);
        if (this.tiles[i] !== T.SNOW) this.tiles[i] = T.GRASS;
      }
    }
  }

  blob(cx, cy, r, t, rng) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x <= 0 || y <= 0 || x >= this.w - 1 || y >= this.h - 1) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < r - rng() * 1.5) this.tiles[this.idx(x, y)] = t;
      }
    }
  }

  carveLine(x0, y0, x1, y1, rad, t) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / steps);
      const y = Math.round(y0 + (y1 - y0) * i / steps);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx <= 0 || yy <= 0 || xx >= this.w - 1 || yy >= this.h - 1) continue;
          const k = this.tiles[this.idx(xx, yy)];
          if (k === T.WATER || k === T.ROCK || k === T.FOREST) this.tiles[this.idx(xx, yy)] = t;
        }
      }
    }
  }
}
