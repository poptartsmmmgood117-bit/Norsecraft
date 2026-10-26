'use strict';
// A* pathfinding on the tile grid.
// A goal is a rectangle {x, y, w, h} plus a range: any walkable tile whose
// Chebyshev distance to the rectangle is within range (and at least minRange)
// satisfies it. Range 0 means "stand inside the rectangle".

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

function rectDist(x, y, g) {
  const dx = x < g.x ? g.x - x : x >= g.x + g.w ? x - (g.x + g.w - 1) : 0;
  const dy = y < g.y ? g.y - y : y >= g.y + g.h ? y - (g.y + g.h - 1) : 0;
  return Math.max(dx, dy);
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, f) {
    const a = this.a;
    a.push([f, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

let _g = new Float64Array(MAP_W * MAP_H);
let _from = new Int32Array(MAP_W * MAP_H);
let _stamp = new Uint32Array(MAP_W * MAP_H);
let _stampN = 0;

// Search buffers follow the map size.
function ensurePathBuffers() {
  const n = MAP_W * MAP_H;
  if (_g.length === n) return;
  _g = new Float64Array(n);
  _from = new Int32Array(n);
  _stamp = new Uint32Array(n);
  _stampN = 0;
}

function findPath(map, sx, sy, goal, maxNodes = Math.max(6000, (MAP_W * MAP_H * 0.7) | 0)) {
  const W = map.w;
  const range = goal.range || 0;
  const minRange = goal.minRange || 0;
  const isGoal = (x, y) => {
    const d = rectDist(x, y, goal);
    return d <= range && d >= minRange;
  };
  if (isGoal(sx, sy)) return { path: [], reached: true };

  _stampN++;
  const heap = new Heap();
  const start = sy * W + sx;
  _stamp[start] = _stampN;
  _g[start] = 0;
  _from[start] = -1;
  heap.push(start, 0);
  let best = start, bestH = rectDist(sx, sy, goal);
  let found = -1, expanded = 0;

  while (heap.size && expanded < maxNodes) {
    const cur = heap.pop();
    const cx = cur % W, cy = (cur / W) | 0;
    if (isGoal(cx, cy)) { found = cur; break; }
    expanded++;
    const cg = _g[cur];
    for (let k = 0; k < 8; k++) {
      const d = DIRS[k];
      const nx = cx + d[0], ny = cy + d[1];
      if (!map.isWalkable(nx, ny)) continue;
      if (k >= 4 && (!map.isWalkable(cx + d[0], cy) || !map.isWalkable(cx, cy + d[1]))) continue;
      const ni = ny * W + nx;
      const ng = cg + d[2];
      // Only a clearly cheaper route counts; equal-cost ties must not reopen nodes.
      if (_stamp[ni] === _stampN && _g[ni] <= ng + 1e-9) continue;
      _stamp[ni] = _stampN;
      _g[ni] = ng;
      _from[ni] = cur;
      const h = rectDist(nx, ny, goal);
      if (h < bestH) { bestH = h; best = ni; }
      heap.push(ni, ng + Math.max(0, h - range) * 1.05);
    }
  }

  const end = found >= 0 ? found : best;
  const path = [];
  let n = end;
  while (n !== start && n >= 0) {
    path.push({ x: n % W, y: (n / W) | 0 });
    n = _from[n];
  }
  path.reverse();
  return { path, reached: found >= 0 };
}

// Breadth-first search over walkable tiles for the nearest tile satisfying fn.
function bfsNearest(map, sx, sy, fn, maxDist = 40) {
  const W = map.w;
  _stampN++;
  const q = [sy * W + sx];
  _stamp[q[0]] = _stampN;
  _g[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    const x = cur % W, y = (cur / W) | 0;
    if (fn(x, y)) return { x, y };
    if (_g[cur] >= maxDist) continue;
    for (let k = 0; k < 4; k++) {
      const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
      if (!map.isWalkable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (_stamp[ni] === _stampN) continue;
      _stamp[ni] = _stampN;
      _g[ni] = _g[cur] + 1;
      q.push(ni);
    }
  }
  return null;
}

// Nearest walkable tile to (x, y), searching outward in rings.
function nearestWalkable(map, x, y, maxR = 12, avoid) {
  if (map.isWalkable(x, y) && !(avoid && avoid(x, y))) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (!map.isWalkable(nx, ny) || (avoid && avoid(nx, ny))) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x: nx, y: ny }; }
      }
    }
    if (best) return best;
  }
  return null;
}
