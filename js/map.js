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
  constructor(seed, players = 2, fjords = false) {
    this.players = players;
    this.fjords = fjords;
    ensurePathBuffers();
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
    this.ensureConnected();
    this.findWaterBodies();
  }

  // Safety net: every base and gold mine must be reachable on foot from the
  // first base. Anything cut off gets a road (or a ford over water) to the rest.
  ensureConnected() {
    const W = this.w, H = this.h;
    // Halls and mines will stand here and block movement.
    const solid = new Uint8Array(W * H);
    for (const r of [...this.starts, ...this.mines]) for (let y = r.y; y < r.y + 3; y++) for (let x = r.x; x < r.x + 3; x++) solid[this.idx(x, y)] = 1;
    for (let pass = 0; pass < 3; pass++) {
      const seen = new Uint8Array(W * H);
      const s = this.starts[0];
      const q = [this.idx(s.x + 1, s.y + 3)];
      seen[q[0]] = 1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % W, y = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.isGround(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (seen[j] || solid[j]) continue;
          seen[j] = 1;
          q.push(j);
        }
      }
      let fixed = false;
      for (const r of [...this.starts, ...this.mines]) {
        let ok = false;
        for (let y = r.y - 1; y <= r.y + 3 && !ok; y++) for (let x = r.x - 1; x <= r.x + 3; x++) if (this.inBounds(x, y) && seen[this.idx(x, y)]) { ok = true; break; }
        if (ok) continue;
        let best = null, bd = 1e9;
        for (const i of q) {
          const d = Math.hypot(i % W - r.x - 1, ((i / W) | 0) - r.y - 1);
          if (d < bd) { bd = d; best = i; }
        }
        if (best == null) continue;
        // Carve from the edge of the footprint so the road does not run under the building.
        const bx = best % W, by = (best / W) | 0;
        const ex = Math.max(r.x - 1, Math.min(r.x + 3, bx)), ey = Math.max(r.y - 1, Math.min(r.y + 3, by));
        this.carveLine(ex, ey, bx, by, 1, T.GRASS);
        for (let y = r.y; y < r.y + 3; y++) for (let x = r.x; x < r.x + 3; x++) if (!this.isGround(x, y)) this.tiles[this.idx(x, y)] = T.GRASS;
        fixed = true;
      }
      if (!fixed) return;
    }
  }

  // Label each connected body of water so ships and shipyards know which sea they are on.
  findWaterBodies() {
    const n = this.w * this.h;
    this.waterId = new Int32Array(n).fill(-1);
    this.waterSize = [];
    for (let i = 0; i < n; i++) {
      if (!this.isSailable(i % this.w, (i / this.w) | 0) || this.waterId[i] >= 0) continue;
      const id = this.waterSize.length;
      const q = [i];
      this.waterId[i] = id;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % this.w, y = (c / this.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (!this.isSailable(nx, ny) || this.waterId[j] >= 0) continue;
          this.waterId[j] = id;
          q.push(j);
        }
      }
      this.waterSize.push(q.length);
    }
  }

  isSailable(x, y) { const t = this.tile(x, y); return t === T.WATER || t === T.FORD; }
  // Open water: big enough to be worth a shipyard.
  isSea(x, y) {
    if (!this.isSailable(x, y)) return false;
    return this.waterSize[this.waterId[this.idx(x, y)]] >= 40;
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tile(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.ROCK; }
  isGround(x, y) {
    const t = this.tile(x, y);
    return t === T.GRASS || t === T.SNOW || t === T.STUMP || t === T.FORD;
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
    if (this.players > 2) return this.generateQuad();
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

    if (this.fjords) {
      // A winding sea along the anti-diagonal, plus an inlet reaching toward each base.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = x + y - (W - 1) + (fbm(x / 6, y / 6, seed + 9) - 0.5) * 7;
          if (Math.abs(d) < 4.5 && x > 0 && y > 0 && x < W - 1 && y < H - 1) this.tiles[this.idx(x, y)] = T.WATER;
        }
      }
      const sx = P.x + 12, sy = P.y + 5;
      const k = (W - 1 - sx - sy) / 1.87;
      this.carveWater(sx, sy, Math.round(sx + k), Math.round(sy + k * 0.87), 2);
    }

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
    this.clearArea(P.x - 6, P.y - 6, 14, 14);
    this.blob(P.x + 9, P.y - 3, 4, T.FOREST, rng);
    this.blob(P.x - 3, P.y + 9, 4, T.FOREST, rng);
    this.clearArea(E.x - 7, E.y - 7, 14, 14);

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
      { x: P.x + 5, y: P.y + 5 },
      { x: E.x - 7, y: E.y - 7 },
      { x: W / 2 - 13, y: H / 2 + 8 },
      { x: W / 2 + 10, y: H / 2 - 11 },
    ];
    this.dirty.length = 0;
  }

  // Four bases, one per corner: build the top-left quarter and mirror it
  // both ways so every player gets the same land.
  generateQuad() {
    const W = this.w, H = this.h, seed = this.seed;
    const rng = makeRng(seed);
    this.noiseFill(rng);
    const P = { x: 9, y: 9 };
    const hw = W / 2, hh = H / 2;
    const jx = Math.floor(rng() * 5) - 2, jy = Math.floor(rng() * 5) - 2;
    if (this.fjords) {
      // Seas along the quarter seams: mirrored, they form a cross of water between the bases.
      for (let y = 1; y < hh; y++) {
        for (let x = 1; x < hw; x++) {
          const wob = (fbm(x / 5, y / 5, seed + 9) - 0.5) * 4;
          if (x >= hw - 4 + wob || y >= hh - 4 + wob) this.tiles[this.idx(x, y)] = T.WATER;
        }
      }
      // An inlet from the sea toward the base, for a shipyard close to home.
      this.carveWater(hw - 2, P.y + 6, P.x + 11, P.y + 6, 2);
    }
    this.carveLine(P.x, P.y, hw - 1, P.y + 2 + jy, 1, T.GRASS);
    this.carveLine(P.x, P.y, P.x + 2 + jx, hh - 1, 1, T.SNOW);
    this.carveLine(P.x, P.y, hw - 1, hh - 1, 1, T.GRASS);
    this.clearArea(P.x - 6, P.y - 6, 14, 14);
    this.blob(P.x + 9, P.y - 3, 4, T.FOREST, rng);
    this.blob(P.x - 3, P.y + 9, 4, T.FOREST, rng);
    const mid = { x: hw - 9, y: hh - 9 };
    if (W >= 64) this.clearArea(mid.x - 2, mid.y - 2, 7, 7);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < hw && y < hh) continue;
        const sx = x < hw ? x : W - 1 - x, sy = y < hh ? y : H - 1 - y;
        this.tiles[this.idx(x, y)] = this.tiles[this.idx(sx, sy)];
      }
    }
    for (let i = 0; i < W * H; i++) this.wood[i] = this.tiles[i] === T.FOREST ? WOOD_PER_TREE : 0;
    const mirror = (x, y, w, h) => [
      { x, y }, { x: W - x - w, y: H - y - h }, { x: W - x - w, y }, { x, y: H - y - h },
    ];
    // Order matches player slots: you top-left, first foe bottom-right, then the other corners.
    this.starts = mirror(P.x - 1, P.y - 1, 3, 3);
    this.mines = mirror(P.x + 5, P.y + 5, 3, 3);
    if (W >= 64) this.mines.push(...mirror(mid.x, mid.y, 3, 3));
    this.dirty.length = 0;
  }

  noiseFill(rng) {
    const W = this.w, H = this.h, seed = this.seed;
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
  }

  carveWater(x0, y0, x1, y1, rad) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / steps);
      const y = Math.round(y0 + (y1 - y0) * i / steps);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx <= 0 || yy <= 0 || xx >= this.w - 1 || yy >= this.h - 1) continue;
          if (dx * dx + dy * dy <= rad * rad + 1) this.tiles[this.idx(xx, yy)] = T.WATER;
        }
      }
    }
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
          // On fjord maps roads cross the sea as fords, so ships can still pass.
          if (k === T.WATER && this.fjords) this.tiles[this.idx(xx, yy)] = T.FORD;
          else if (k === T.WATER || k === T.ROCK || k === T.FOREST) this.tiles[this.idx(xx, yy)] = t;
        }
      }
    }
  }
}
