'use strict';
// Core simulation: entities, orders, combat, economy, production.

const G = {
  map: null, ents: [], byId: new Map(), nextId: 1,
  projectiles: [], effects: [], areas: [], msgs: [],
  players: [], human: 0, time: 0, over: null,
  vis: null, explored: null, visT: 0, checkT: 0,
  ai: null, speed: 1, paused: false, attackMsgT: 0,
};

// ---------- setup ----------

function newGame(opts) {
  const seed = opts.seed || (Math.random() * 1e9) | 0;
  G.map = new GameMap(seed);
  G.ents = [];
  G.byId = new Map();
  G.nextId = 1;
  G.projectiles = [];
  G.effects = [];
  G.areas = [];
  G.msgs = [];
  G.time = 0;
  G.over = null;
  G.speed = opts.speed || 1;
  G.paused = false;
  G.vis = new Uint8Array(MAP_W * MAP_H);
  G.explored = new Uint8Array(MAP_W * MAP_H);
  G.revealAll = false;
  G.tut = null;
  G.mission = null;
  const other = opts.faction === 'vikings' ? 'jotnar' : 'vikings';
  G.players = [
    makePlayer(0, opts.faction, false),
    makePlayer(1, other, true),
  ];
  G.human = 0;

  for (const m of G.map.mines) spawnBuilding('mine', -1, m.x, m.y, true);
  G.players.forEach((p, i) => {
    const s = G.map.starts[i];
    spawnBuilding('hall', p.id, s.x, s.y, true);
    const dir = i === 0 ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const t = nearestWalkable(G.map, s.x + 1 + dir * (k % 2 === 0 ? 3 : 4), s.y + 1 + dir * (k < 2 ? 0 : 1) - dir, 6);
      if (t) spawnUnit('worker', p.id, t.x, t.y);
    }
  });
  G.ai = new AI(1, opts.difficulty || 'normal');
  if (opts.aiForHuman) G.ai2 = new AI(0, opts.difficulty || 'normal');
  else G.ai2 = null;
  updateFood();
  updateVisibility();
}

function makePlayer(id, faction, ai) {
  return {
    id, faction, ai, gold: 600, wood: 400, food: 0, foodCap: 0,
    up: { weapons: 0, armor: 0, arrows: 0, summon: 0, storm: 0 },
    color: FACTIONS[faction].color, stats: { killed: 0, lost: 0, gold: 0, wood: 0 },
  };
}

function humanPlayer() { return G.players[G.human]; }

// ---------- entities ----------

function spawnUnit(type, owner, tx, ty) {
  const d = UNITS[type];
  const u = {
    id: G.nextId++, kind: 'unit', type, owner,
    x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
    hp: d.hp, maxHp: d.hp, order: null, path: null, pathI: 0, goal: null,
    cd: 0, carry: null, hidden: false, inside: null, facing: owner === 0 ? 1 : -1,
    anim: Math.random() * 10, atkAnim: 0, scanT: Math.random() * 0.5, hitT: 0, hold: false,
  };
  if (d.mana) u.mana = 50;
  if (d.summon) u.life = SUMMON_LIFE;
  G.ents.push(u);
  G.byId.set(u.id, u);
  return u;
}

function spawnBuilding(type, owner, tx, ty, built) {
  const d = BUILDINGS[type];
  const b = {
    id: G.nextId++, kind: 'bldg', type, owner, tx, ty, w: d.w, h: d.h,
    x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE,
    hp: built ? d.hp : Math.max(1, d.hp * 0.1), maxHp: d.hp,
    progress: built ? 1 : 0, built: !!built, queue: [], rally: null,
    cd: 0, gold: type === 'mine' ? MINE_GOLD : 0, builder: null, hitT: 0, busyT: 0,
  };
  for (let y = ty; y < ty + d.h; y++) {
    for (let x = tx; x < tx + d.w; x++) G.map.bldg[G.map.idx(x, y)] = b.id;
  }
  G.ents.push(b);
  G.byId.set(b.id, b);
  return b;
}

function tileOf(u) { return { x: Math.floor(u.x / TILE), y: Math.floor(u.y / TILE) }; }
function entRect(e) {
  if (e.kind === 'bldg') return { x: e.tx, y: e.ty, w: e.w, h: e.h };
  const t = tileOf(e);
  return { x: t.x, y: t.y, w: 1, h: 1 };
}
function tileDist(u, e) {
  const t = tileOf(u);
  return rectDist(t.x, t.y, entRect(e));
}
function isEnemy(a, b) { return a.owner >= 0 && b.owner >= 0 && a.owner !== b.owner; }
function alive(e) { return e && !e.dead; }
function defOf(e) { return e.kind === 'unit' ? UNITS[e.type] : BUILDINGS[e.type]; }
function nameOf(e) {
  if (e.type === 'mine') return 'Gold Mine';
  const f = G.players[e.owner].faction;
  return e.kind === 'unit' ? unitName(e.type, f) : bldgName(e.type, f);
}

function atkOf(e) {
  const d = defOf(e);
  if (!d.atk) return 0;
  const up = e.owner >= 0 ? G.players[e.owner].up : null;
  let a = d.atk;
  if (up) {
    if ((e.type === 'melee' || e.type === 'rider') && up.weapons) a += 2;
    if ((e.type === 'ranged' || e.type === 'tower') && up.arrows) a += 2;
  }
  return a;
}
function armorOf(e) {
  const d = defOf(e);
  let a = d.armor || 0;
  if (e.kind === 'unit' && e.owner >= 0 && G.players[e.owner].up.armor) a += 1;
  return a;
}

function hasBuilt(pid, type) {
  return G.ents.some(e => !e.dead && e.owner === pid && e.type === type && e.kind === 'bldg' && e.built);
}
function reqsMet(pid, req) { return !req || req.every(r => hasBuilt(pid, r)); }
function canAfford(p, d) { return p.gold >= (d.gold || 0) && p.wood >= (d.wood || 0); }
function pay(p, d) { p.gold -= d.gold || 0; p.wood -= d.wood || 0; }
function refund(p, d, frac = 1) { p.gold += Math.floor((d.gold || 0) * frac); p.wood += Math.floor((d.wood || 0) * frac); }

function msg(text, pid = G.human) {
  if (pid !== G.human) return;
  G.msgs.push({ text, t: 5 });
  if (G.msgs.length > 5) G.msgs.shift();
}

// ---------- movement ----------

function unitGoal(u, goal) {
  u.goal = goal;
  const t = tileOf(u);
  const r = findPath(G.map, t.x, t.y, goal);
  u.path = r.path;
  u.pathI = 0;
  u.reached = r.reached;
  return r;
}

// Advance along the path. Returns true once the path is exhausted.
function stepMove(u, dt) {
  if (!u.path || u.pathI >= u.path.length) return true;
  const n = u.path[u.pathI];
  if (!G.map.isWalkable(n.x, n.y)) {
    unitGoal(u, u.goal);
    if (!u.path.length) return true;
    return false;
  }
  const tx = n.x * TILE + TILE / 2, ty = n.y * TILE + TILE / 2;
  const dx = tx - u.x, dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  const step = UNITS[u.type].speed * TILE * dt;
  if (Math.abs(dx) > 0.5) u.facing = dx > 0 ? 1 : -1;
  u.anim += dt * UNITS[u.type].speed * 2.5;
  if (dist <= step) {
    u.x = tx; u.y = ty;
    u.pathI++;
  } else {
    u.x += dx / dist * step;
    u.y += dy / dist * step;
  }
  return u.pathI >= u.path.length;
}

function atGoal(u) {
  const t = tileOf(u);
  const g = u.goal;
  if (!g) return true;
  const d = rectDist(t.x, t.y, g);
  return d <= (g.range || 0) && d >= (g.minRange || 0);
}

function face(u, e) {
  const dx = e.x - u.x;
  if (Math.abs(dx) > 1) u.facing = dx > 0 ? 1 : -1;
}

// ---------- unit update ----------

function updateUnit(u, dt) {
  if (u.hidden) {
    if (u.inside && u.inside.mine) {
      u.inside.t -= dt;
      if (u.inside.t <= 0) exitMine(u);
    }
    return;
  }
  if (u.life != null) {
    u.life -= dt;
    if (u.life <= 0) { kill(u, null); return; }
  }
  if (u.mana != null) {
    u.mana = Math.min(UNITS[u.type].mana, u.mana + MANA_REGEN * dt);
    autoHeal(u, dt);
  }
  u.cd -= dt;
  if (u.atkAnim > 0) u.atkAnim -= dt;
  if (u.hitT > 0) u.hitT -= dt;
  const o = u.order;
  if (!o) return idleUnit(u, dt);
  switch (o.type) {
    case 'move':
      if (stepMove(u, dt)) u.order = null;
      break;
    case 'amove': doAttackMove(u, dt, o); break;
    case 'attack': doAttack(u, dt, o); break;
    case 'gold': doGold(u, dt, o); break;
    case 'wood': doWood(u, dt, o); break;
    case 'build': doBuild(u, dt, o); break;
    case 'cast': doCast(u, dt, o); break;
    case 'repair': doRepair(u, dt, o); break;
    default: u.order = null;
  }
}

function idleUnit(u, dt) {
  u.scanT -= dt;
  if (u.scanT > 0) return;
  u.scanT = 0.4 + Math.random() * 0.2;
  if (u.type === 'worker') return;
  const d = UNITS[u.type];
  const radius = u.hold ? d.range : d.sight;
  const t = findEnemyNear(u, radius);
  if (t) u.order = { type: 'attack', target: t.id, auto: true, hold: u.hold, home: { x: u.x, y: u.y }, repath: 0 };
}

function findEnemyNear(u, radius) {
  const ut = tileOf(u);
  let best = null, bs = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.hidden || !isEnemy(u, e)) continue;
    const d = rectDist(ut.x, ut.y, entRect(e));
    if (d > radius) continue;
    let s = d;
    if (e.kind === 'bldg') s += e.type === 'tower' ? 2 : 8;
    else if (e.type === 'worker') s += 2;
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

function doAttackMove(u, dt, o) {
  u.scanT -= dt;
  if (u.scanT <= 0) {
    u.scanT = 0.35 + Math.random() * 0.15;
    const d = UNITS[u.type];
    const t = findEnemyNear(u, d.sight);
    if (t && u.type !== 'worker') {
      u.order = { type: 'attack', target: t.id, auto: true, resume: o, repath: 0 };
      u.path = null;
      return;
    }
  }
  if (!u.path) unitGoal(u, o.goal);
  if (stepMove(u, dt)) u.order = null;
}

function doAttack(u, dt, o) {
  const t = G.byId.get(o.target);
  const d = UNITS[u.type];
  if (!alive(t) || t.hidden) return endAttack(u, o);
  const dist = tileDist(u, t);
  const minR = d.minRange || 0;
  if (dist <= d.range && dist >= minR) {
    u.path = null;
    face(u, t);
    if (u.cd <= 0) {
      strike(u, t);
      u.cd = d.cd;
      u.atkAnim = 0.3;
    }
    return;
  }
  if (o.hold) return endAttack(u, o);
  if (o.auto && o.home && Math.hypot(u.x - o.home.x, u.y - o.home.y) > TILE * 12) {
    const home = o.home;
    u.order = { type: 'move' };
    unitGoal(u, { x: Math.floor(home.x / TILE), y: Math.floor(home.y / TILE), w: 1, h: 1, range: 0 });
    return;
  }
  o.repath = (o.repath || 0) - dt;
  if (!u.path || u.pathI >= u.path.length || o.repath <= 0) {
    const r = entRect(t);
    const res = unitGoal(u, { x: r.x, y: r.y, w: r.w, h: r.h, range: d.range, minRange: minR });
    o.repath = 0.7 + Math.random() * 0.3;
    if (!res.path.length && !res.reached) return endAttack(u, o);
  }
  stepMove(u, dt);
}

function endAttack(u, o) {
  u.path = null;
  u.order = o.resume || null;
  if (u.order) u.scanT = 0;
}

function strike(u, t) {
  const d = UNITS[u.type] || BUILDINGS[u.type];
  const atk = atkOf(u);
  if (d.projectile) {
    G.projectiles.push({
      x: u.x, y: u.y - 10, tx: t.x, ty: t.y, target: t.id, kind: d.projectile,
      speed: d.projectile === 'rock' ? 260 : 420, dmg: atk, owner: u.owner, src: u.id, srcType: u.type,
      splash: d.splash || 0, faction: G.players[u.owner].faction, sx: u.x, sy: u.y - 10,
    });
  } else {
    damage({ id: u.id, owner: u.owner, type: u.type }, t, atk);
  }
}

function damage(src, t, atk, mult = 1) {
  if (t.dead || t.type === 'mine') return;
  let dmg = Math.max(1, atk - armorOf(t)) * (0.6 + Math.random() * 0.4) * mult;
  const sd = UNITS[src.type];
  if (t.kind === 'bldg' && sd && sd.bldgBonus) dmg *= sd.bldgBonus;
  t.hp -= dmg;
  t.hitT = 0.15;
  if (t.owner === G.human || src.owner === G.human) G.combatT = 8;
  if (t.kind === 'unit') G.effects.push({ type: 'blood', x: t.x + (Math.random() - 0.5) * 8, y: t.y + 4, t: 0.5 });
  if (t.owner === G.human && src.owner !== G.human && G.attackMsgT <= 0) {
    G.attackMsgT = 15;
    msg(t.kind === 'bldg' ? 'Our settlement is under attack!' : 'Our warriors are under attack!');
    G.lastAttack = { x: t.x, y: t.y };
    sfx('alarm');
  }
  if (t.hp <= 0) return kill(t, src);
  const attacker = G.byId.get(src.id);
  if (!alive(attacker) || attacker.hidden) return;
  if (t.kind === 'unit') {
    if (!t.order && !t.hidden && !t.hold && (t.type !== 'worker' || attacker.kind === 'unit')) {
      t.order = { type: 'attack', target: attacker.id, auto: true, home: { x: t.x, y: t.y }, repath: 0 };
    }
  }
  // Rally nearby idle allies.
  for (const e of G.ents) {
    if (e.kind !== 'unit' || e.dead || e.hidden || e.order || e.owner !== t.owner || e.type === 'worker' || e.hold) continue;
    if (Math.hypot(e.x - t.x, e.y - t.y) > TILE * 7) continue;
    e.order = { type: 'attack', target: attacker.id, auto: true, home: { x: e.x, y: e.y }, repath: 0 };
  }
  if (G.ai && t.owner === G.ai.pid) G.ai.alert(attacker);
  if (G.ai2 && t.owner === G.ai2.pid) G.ai2.alert(attacker);
}

function kill(t, src) {
  if (t.dead) return;
  t.dead = true;
  if (src && src.owner >= 0 && t.owner >= 0) {
    G.players[src.owner].stats.killed++;
    G.players[t.owner].stats.lost++;
  }
  if (t.kind === 'unit') {
    if (t.life != null) {
      G.effects.push({ type: 'poof', x: t.x, y: t.y, t: 0.8 });
    } else {
      G.effects.push({ type: 'corpse', x: t.x, y: t.y, t: 12, faction: G.players[t.owner].faction, color: G.players[t.owner].color });
      if (!t.hidden) sfx('die');
    }
    if (t.inside && t.inside.bldg) {
      const b = G.byId.get(t.inside.bldg);
      if (b && b.builder === t.id) b.builder = null;
    }
  } else {
    for (let y = t.ty; y < t.ty + t.h; y++) {
      for (let x = t.tx; x < t.tx + t.w; x++) G.map.bldg[G.map.idx(x, y)] = 0;
    }
    G.effects.push({ type: 'rubble', x: t.x, y: t.y, w: t.w, h: t.h, t: 30 });
    G.effects.push({ type: 'boom', x: t.x, y: t.y, t: 0.8, r: t.w * TILE * 0.7 });
    sfx('crash');
    // Eject anyone inside.
    for (const e of G.ents) {
      if (e.kind === 'unit' && e.hidden && e.inside && (e.inside.bldg === t.id || e.inside.mine === t.id)) {
        ejectNear(e, t);
        e.order = null;
      }
    }
    if (t.type === 'mine') msg('A gold mine has collapsed.');
    updateFood();
  }
}

function ejectNear(u, b) {
  const sp = nearestWalkable(G.map, b.tx + Math.floor(b.w / 2), b.ty + b.h, 10) || nearestWalkable(G.map, b.tx, b.ty, 20);
  if (sp) { u.x = sp.x * TILE + TILE / 2; u.y = sp.y * TILE + TILE / 2; }
  u.hidden = false;
  u.inside = null;
  u.path = null;
}

// ---------- gathering ----------

function nearestDropoff(u, res) {
  let best = null, bd = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'bldg' || e.owner !== u.owner || !e.built) continue;
    const d = BUILDINGS[e.type];
    if (!d.dropoff || !d.dropoff.includes(res)) continue;
    const dist = Math.hypot(e.x - u.x, e.y - u.y);
    if (dist < bd) { bd = dist; best = e; }
  }
  return best;
}

function nearestMine(x, y, exclude) {
  let best = null, bd = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.type !== 'mine' || e === exclude) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function deposit(u) {
  const p = G.players[u.owner];
  let amt = u.carry.amt;
  if (G.ai && u.owner === G.ai.pid) amt = Math.round(amt * G.ai.diff.gather);
  p[u.carry.res] += amt;
  p.stats[u.carry.res] += amt;
  u.carry = null;
}

function goReturn(u, o) {
  const drop = nearestDropoff(u, u.carry.res);
  if (!drop) { u.order = null; return; }
  if (!u.path || u.goalId !== drop.id) {
    u.goalId = drop.id;
    unitGoal(u, { ...entRect(drop), range: 1 });
  }
  if (stepMove(u, 0) || u.pathI >= u.path.length) {
    if (tileDist(u, drop) <= 1) {
      deposit(u);
      o.stage = 'to';
      u.path = null;
      u.goalId = null;
      if (o.returnOnly) u.order = null;
    } else {
      u.order = null;
    }
  }
}

function doGold(u, dt, o) {
  if (u.carry && u.carry.res === 'gold' && u.carry.amt > 0) o.stage = 'back';
  if (o.stage === 'back') {
    if (!u.path || u.pathI < u.path.length) {
      if (u.path) stepMove(u, dt);
    }
    return goReturn(u, o);
  }
  let mine = G.byId.get(o.mine);
  if (!alive(mine)) {
    mine = nearestMine(u.x, u.y);
    if (!mine || Math.hypot(mine.x - u.x, mine.y - u.y) > TILE * 30) { u.order = null; return; }
    o.mine = mine.id;
    u.path = null;
  }
  if (!u.path) unitGoal(u, { ...entRect(mine), range: 1 });
  if (stepMove(u, dt)) {
    if (tileDist(u, mine) <= 1) {
      u.hidden = true;
      u.inside = { mine: mine.id, t: MINE_TIME };
      u.lastMine = mine.id;
      u.path = null;
    } else {
      u.order = null;
    }
  }
}

function exitMine(u) {
  const mine = G.byId.get(u.inside.mine);
  let amt = 0;
  if (alive(mine)) {
    amt = Math.min(CARRY, mine.gold);
    mine.gold -= amt;
    if (mine.gold <= 0) kill(mine, null);
  }
  const drop = nearestDropoff(u, 'gold');
  const from = mine || u;
  const aim = drop ? { x: Math.floor(drop.x / TILE), y: Math.floor(drop.y / TILE) } : tileOf(u);
  // Pop out on the side facing the drop-off.
  let sp = null;
  if (mine) {
    let bd = 1e9;
    for (let y = mine.ty - 1; y <= mine.ty + mine.h; y++) {
      for (let x = mine.tx - 1; x <= mine.tx + mine.w; x++) {
        if (!G.map.isWalkable(x, y)) continue;
        const d = Math.hypot(x - aim.x, y - aim.y);
        if (d < bd) { bd = d; sp = { x, y }; }
      }
    }
  }
  if (!sp) sp = nearestWalkable(G.map, Math.floor(from.x / TILE), Math.floor(from.y / TILE), 10);
  if (sp) { u.x = sp.x * TILE + TILE / 2; u.y = sp.y * TILE + TILE / 2; }
  u.hidden = false;
  u.inside = null;
  if (amt > 0) u.carry = { res: 'gold', amt };
  if (u.order && u.order.type === 'gold') u.order.stage = amt > 0 ? 'back' : 'to';
  u.path = null;
}

function findTreeSpot(u, near) {
  const map = G.map;
  const t = tileOf(u);
  const origin = near && map.isWalkable(near.x, near.y) ? near : t;
  const ref = near || t;
  // Prefer a standing tile adjacent to a forest tile, close to the requested tree.
  let best = null;
  const cands = [];
  bfsNearest(map, t.x, t.y, (x, y) => {
    for (let k = 0; k < 8; k++) {
      const fx = x + DIRS[k][0], fy = y + DIRS[k][1];
      if (map.isForest(fx, fy)) {
        cands.push({ x, y, tree: { x: fx, y: fy } });
        break;
      }
    }
    return cands.length >= 12;
  }, 40);
  let bd = 1e9;
  for (const c of cands) {
    const d = Math.hypot(c.tree.x - ref.x, c.tree.y - ref.y) + 0.3 * Math.hypot(c.x - t.x, c.y - t.y);
    if (d < bd) { bd = d; best = c; }
  }
  void origin;
  return best;
}

function doWood(u, dt, o) {
  if (u.carry && u.carry.res === 'wood' && u.carry.amt > 0 && o.stage !== 'back') o.stage = 'back';
  if (o.stage === 'back') {
    if (u.path && u.pathI < u.path.length) stepMove(u, dt);
    return goReturn(u, o);
  }
  if (o.stage === 'chop') {
    if (!G.map.isForest(o.tree.x, o.tree.y)) { o.stage = 'to'; u.path = null; return; }
    o.t -= dt;
    u.anim += dt * 3;
    u.facing = o.tree.x * TILE + 16 > u.x ? 1 : o.tree.x * TILE + 16 < u.x ? -1 : u.facing;
    u.chopping = true;
    if (o.t <= 0) {
      u.chopping = false;
      const got = G.map.chop(o.tree.x, o.tree.y, WOOD_CARRY);
      if (got > 0) { u.carry = { res: 'wood', amt: got }; o.stage = 'back'; u.path = null; sfx('chop'); }
      else o.stage = 'to';
    }
    return;
  }
  u.chopping = false;
  if (!u.path) {
    const spot = findTreeSpot(u, o.tree);
    if (!spot) { u.order = null; msg('No reachable forest nearby.', u.owner); return; }
    o.tree = spot.tree;
    o.spot = { x: spot.x, y: spot.y };
    u.lastTree = spot.tree;
    unitGoal(u, { x: spot.x, y: spot.y, w: 1, h: 1, range: 0 });
  }
  if (stepMove(u, dt)) {
    const t = tileOf(u);
    if (G.map.isForest(o.tree.x, o.tree.y) && Math.max(Math.abs(t.x - o.tree.x), Math.abs(t.y - o.tree.y)) <= 1) {
      o.stage = 'chop';
      o.t = CHOP_TIME;
    }
    u.path = null;
  }
}

// Repairing restores hit points over time and costs 35% of the building's
// price for a full repair, paid as the work happens.
function doRepair(u, dt, o) {
  const b = G.byId.get(o.bid);
  if (!alive(b) || b.kind !== 'bldg' || b.owner !== u.owner) { u.order = null; u.chopping = false; return; }
  if (!b.built) { u.order = { type: 'build', bid: b.id }; u.path = null; u.chopping = false; return; }
  if (b.hp >= b.maxHp) { u.order = null; u.chopping = false; return; }
  if (tileDist(u, b) > 1) {
    u.chopping = false;
    if (!u.path) {
      const r = unitGoal(u, { ...entRect(b), range: 1 });
      if (!r.path.length && !r.reached) { u.order = null; return; }
    }
    if (stepMove(u, dt) && tileDist(u, b) > 1) u.order = null;
    return;
  }
  u.path = null;
  face(u, b);
  u.chopping = true;
  u.anim += dt * 3;
  const d = BUILDINGS[b.type];
  const p = G.players[u.owner];
  const heal = b.maxHp / d.time * 0.6 * dt;
  const frac = heal / b.maxHp;
  o.owe = o.owe || { gold: 0, wood: 0 };
  o.owe.gold += (d.gold || 0) * 0.35 * frac;
  o.owe.wood += (d.wood || 0) * 0.35 * frac;
  const g = Math.floor(o.owe.gold), w = Math.floor(o.owe.wood);
  if (p.gold < g || p.wood < w) {
    msg('Not enough ' + (p.gold < g ? 'gold' : 'lumber') + ' to keep repairing.', u.owner);
    u.order = null;
    u.chopping = false;
    return;
  }
  p.gold -= g; p.wood -= w;
  o.owe.gold -= g; o.owe.wood -= w;
  b.hp = Math.min(b.maxHp, b.hp + heal);
  if (b.hp >= b.maxHp && u.owner === G.human) sfx('done');
}

function doBuild(u, dt, o) {
  const b = G.byId.get(o.bid);
  if (!alive(b) || b.built) { u.order = null; return; }
  if (!u.path) {
    const r = unitGoal(u, { ...entRect(b), range: 1 });
    if (!r.path.length && !r.reached) { u.order = null; return; }
  }
  if (stepMove(u, dt)) {
    if (tileDist(u, b) <= 1) {
      if (b.builder && alive(G.byId.get(b.builder))) { u.order = null; return; }
      b.builder = u.id;
      u.hidden = true;
      u.inside = { bldg: b.id };
      u.path = null;
      u.order = null;
    } else {
      u.order = null;
    }
  }
}

// ---------- buildings ----------

function updateBuilding(b, dt) {
  if (b.hitT > 0) b.hitT -= dt;
  const d = BUILDINGS[b.type];
  const p = G.players[b.owner];
  if (!b.built) {
    const builder = G.byId.get(b.builder);
    if (!alive(builder)) { b.builder = null; return; }
    const step = dt / d.time;
    b.progress = Math.min(1, b.progress + step);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * step);
    if (b.progress >= 1) {
      b.built = true;
      ejectNear(builder, b);
      builder.order = null;
      updateFood();
      msg(`${bldgName(b.type, p.faction)} complete.`, b.owner);
      if (b.owner === G.human) sfx('done');
    }
    return;
  }
  if (b.type === 'tower') {
    b.cd -= dt;
    if (b.cd <= 0) {
      const t = findEnemyNear(b, d.range);
      if (t) {
        strike(b, t);
        b.cd = d.cd;
      }
    }
  }
  if (b.queue.length) {
    const q = b.queue[0];
    if (q.unit && !q.started) {
      if (p.food + 1 > p.foodCap) {
        if (!q.warned) { msg('Not enough food. Build more ' + bldgName('farm', p.faction) + 's.', b.owner); q.warned = true; }
        return;
      }
      q.started = true;
      updateFood();
    }
    q.t += dt;
    if (q.t >= q.time) {
      b.queue.shift();
      if (q.unit) finishTraining(b, q.unit);
      else {
        p.up[q.research] = 1;
        msg(`${researchName(q.research, p.faction)} researched.`, b.owner);
        if (b.owner === G.human) sfx('done');
      }
      updateFood();
    }
  }
}

function finishTraining(b, type) {
  const p = G.players[b.owner];
  const aim = b.rally ? b.rally : { x: b.tx + Math.floor(b.w / 2), y: b.ty + b.h };
  let sp = null, bd = 1e9;
  for (let y = b.ty - 1; y <= b.ty + b.h; y++) {
    for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
      if (!G.map.isWalkable(x, y)) continue;
      const d = Math.hypot(x - aim.x, y - aim.y);
      if (d < bd) { bd = d; sp = { x, y }; }
    }
  }
  if (!sp) sp = nearestWalkable(G.map, b.tx, b.ty, 15);
  if (!sp) return;
  const u = spawnUnit(type, b.owner, sp.x, sp.y);
  msg(`${unitName(type, p.faction)} ready.`, b.owner);
  if (b.owner === G.human) sfx('ready');
  if (b.rally) {
    const r = b.rally;
    const mine = G.byId.get(G.map.bldg[G.map.idx(r.x, r.y)]);
    if (type === 'worker' && mine && mine.type === 'mine') cmdGather([u], mine, null);
    else if (type === 'worker' && G.map.isForest(r.x, r.y)) cmdGather([u], null, { x: r.x, y: r.y });
    else cmdMove([u], r.x, r.y, false);
  }
  if (G.ai && b.owner === G.ai.pid) G.ai.onTrained(u);
  if (G.ai2 && b.owner === G.ai2.pid) G.ai2.onTrained(u);
}

function updateFood() {
  for (const p of G.players) { p.food = 0; p.foodCap = 0; }
  for (const e of G.ents) {
    if (e.dead || e.owner < 0) continue;
    const p = G.players[e.owner];
    if (e.kind === 'unit') { if (e.life == null) p.food++; }
    else {
      if (e.built && BUILDINGS[e.type].food) p.foodCap += BUILDINGS[e.type].food;
      if (e.queue.length && e.queue[0].unit && e.queue[0].started) p.food++;
    }
  }
  for (const p of G.players) p.foodCap = Math.min(MAX_FOOD, p.foodCap);
}

// ---------- commands ----------

function formationTiles(n, tx, ty) {
  const taken = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nearestWalkable(G.map, tx, ty, 14, (x, y) => taken.has(x + y * MAP_W));
    if (!t) { out.push({ x: tx, y: ty }); continue; }
    taken.add(t.x + t.y * MAP_W);
    out.push(t);
  }
  return out;
}

function cmdMove(units, tx, ty, attack) {
  const list = units.filter(u => u.kind === 'unit' && !u.hidden && !u.dead);
  const tiles = formationTiles(list.length, tx, ty);
  // Assign nearest-first so units do not cross paths too much.
  list.sort((a, b) => Math.hypot(a.x - tx * TILE, a.y - ty * TILE) - Math.hypot(b.x - tx * TILE, b.y - ty * TILE));
  list.forEach((u, i) => {
    const t = tiles[i];
    const goal = { x: t.x, y: t.y, w: 1, h: 1, range: 0 };
    u.hold = false;
    u.chopping = false;
    u.order = { type: attack ? 'amove' : 'move', goal };
    unitGoal(u, goal);
  });
}

function cmdAttack(units, target) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.hidden || u.dead || u === target) continue;
    u.hold = false;
    u.chopping = false;
    u.order = { type: 'attack', target: target.id, repath: 0 };
    u.path = null;
  }
}

function cmdGather(units, mine, tree) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.type !== 'worker' || u.hidden || u.dead) continue;
    u.hold = false;
    u.path = null;
    u.chopping = false;
    if (mine) {
      if (u.carry && u.carry.res !== 'gold') u.carry = null;
      u.order = { type: 'gold', mine: mine.id, stage: u.carry ? 'back' : 'to' };
    } else {
      if (u.carry && u.carry.res !== 'wood') u.carry = null;
      u.order = { type: 'wood', tree: tree ? { x: tree.x, y: tree.y } : null, stage: u.carry ? 'back' : 'to' };
    }
  }
}

function cmdReturn(units) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.type !== 'worker' || !u.carry || u.hidden) continue;
    u.path = null;
    if (u.carry.res === 'gold') u.order = { type: 'gold', mine: u.lastMine, stage: 'back' };
    else u.order = { type: 'wood', tree: u.lastTree, stage: 'back' };
  }
}

function cmdRepair(units, b) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.type !== 'worker' || u.hidden || u.dead) continue;
    u.hold = false;
    u.path = null;
    u.chopping = false;
    u.order = { type: 'repair', bid: b.id };
  }
}

function cmdStop(units) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.hidden) continue;
    u.order = null; u.path = null; u.hold = false; u.chopping = false;
  }
}

function cmdHold(units) {
  cmdStop(units);
  for (const u of units) if (u.kind === 'unit') u.hold = true;
}

function canPlace(type, tx, ty, pid, builder) {
  const d = BUILDINGS[type];
  for (let y = ty; y < ty + d.h; y++) {
    for (let x = tx; x < tx + d.w; x++) {
      if (!G.map.isWalkable(x, y)) return false;
      if (pid === G.human && !G.explored[G.map.idx(x, y)] && !G.revealAll) return false;
    }
  }
  for (const e of G.ents) {
    if (e.kind !== 'unit' || e.dead || e.hidden || e === builder) continue;
    const t = tileOf(e);
    if (t.x >= tx && t.x < tx + d.w && t.y >= ty && t.y < ty + d.h) return false;
  }
  return true;
}

// Returns an error string or the new building.
function cmdBuild(worker, type, tx, ty) {
  const p = G.players[worker.owner];
  const d = BUILDINGS[type];
  if (!reqsMet(p.id, d.req)) return 'Requires ' + d.req.map(r => bldgName(r, p.faction)).join(', ');
  if (!canAfford(p, d)) return p.gold < d.gold ? 'Not enough gold.' : 'Not enough lumber.';
  if (!canPlace(type, tx, ty, p.id, worker)) return "Can't build there.";
  pay(p, d);
  const b = spawnBuilding(type, p.id, tx, ty, false);
  // If the worker itself stands on the site, step it to the edge.
  const wt = tileOf(worker);
  if (wt.x >= tx && wt.x < tx + d.w && wt.y >= ty && wt.y < ty + d.h) {
    const sp = nearestWalkable(G.map, wt.x, wt.y, 6);
    if (sp) { worker.x = sp.x * TILE + 16; worker.y = sp.y * TILE + 16; }
  }
  if (worker.carry) worker.carry = null;
  worker.hold = false;
  worker.chopping = false;
  worker.order = { type: 'build', bid: b.id };
  worker.path = null;
  return b;
}

function cmdTrain(b, type) {
  const p = G.players[b.owner];
  const d = UNITS[type];
  if (!b.built) return 'Not built yet.';
  if (!reqsMet(p.id, d.req)) return 'Requires ' + d.req.map(r => bldgName(r, p.faction)).join(', ') + '.';
  if (b.queue.length >= 5) return 'Queue is full.';
  if (!canAfford(p, d)) return p.gold < d.gold ? 'Not enough gold.' : 'Not enough lumber.';
  pay(p, d);
  b.queue.push({ unit: type, t: 0, time: d.time });
  return null;
}

function researchState(pid, key) {
  const p = G.players[pid];
  if (p.up[key]) return 'done';
  for (const e of G.ents) {
    if (!e.dead && e.owner === pid && e.kind === 'bldg' && e.queue.some(q => q.research === key)) return 'busy';
  }
  return 'open';
}

function cmdResearch(b, key) {
  const p = G.players[b.owner];
  const r = RESEARCH[key];
  if (!b.built) return 'Not built yet.';
  if (researchState(p.id, key) !== 'open') return 'Already researched.';
  if (b.queue.length >= 5) return 'Queue is full.';
  if (!canAfford(p, r)) return p.gold < r.gold ? 'Not enough gold.' : 'Not enough lumber.';
  pay(p, r);
  b.queue.push({ research: key, t: 0, time: r.time });
  return null;
}

function cmdCancel(b) {
  const p = G.players[b.owner];
  if (!b.built) {
    refund(p, BUILDINGS[b.type], 0.75);
    const builder = G.byId.get(b.builder);
    b.dead = true;
    for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) G.map.bldg[G.map.idx(x, y)] = 0;
    if (alive(builder)) { ejectNear(builder, b); builder.order = null; }
    for (const e of G.ents) if (e.kind === 'unit' && e.order && e.order.type === 'build' && e.order.bid === b.id) e.order = null;
    return;
  }
  const q = b.queue.pop();
  if (!q) return;
  refund(p, q.unit ? UNITS[q.unit] : RESEARCH[q.research]);
  updateFood();
}

// ---------- magic ----------

function spellReady(u, key) {
  const sp = SPELLS[key];
  const p = G.players[u.owner];
  if (sp.req && !p.up[sp.req]) return false;
  return u.mana >= sp.mana;
}

// Casters heal the most wounded ally in reach without dropping what they are doing.
function autoHeal(u, dt) {
  u.healScan = (u.healScan || 0) - dt;
  // Once stronger spells are known, keep enough mana in reserve to cast them.
  const up = G.players[u.owner].up;
  const floor = up.summon || up.storm ? 75 : SPELLS.heal.mana;
  if (u.healScan > 0 || u.mana < floor) return;
  u.healScan = 0.5;
  const ut = tileOf(u);
  let best = null, worst = 14;
  for (const e of G.ents) {
    if (e.kind !== 'unit' || e.dead || e.hidden || e.owner !== u.owner) continue;
    const missing = e.maxHp - e.hp;
    if (missing <= worst) continue;
    if (rectDist(ut.x, ut.y, entRect(e)) > SPELLS.heal.range) continue;
    worst = missing;
    best = e;
  }
  if (best) castHeal(u, best);
}

function castHeal(u, t) {
  u.mana -= SPELLS.heal.mana;
  t.hp = Math.min(t.maxHp, t.hp + SPELLS.heal.amount);
  face(u, t);
  u.atkAnim = 0.3;
  G.effects.push({ type: 'heal', x: t.x, y: t.y, t: 1, faction: G.players[u.owner].faction });
  if (u.owner === G.human || t.owner === G.human) sfx('heal');
}

function castSummon(u) {
  u.mana -= SPELLS.summon.mana;
  const faction = G.players[u.owner].faction;
  const type = faction === 'vikings' ? 'einherjar' : 'wolf';
  const t = tileOf(u);
  const taken = new Set();
  const out = [];
  for (let i = 0; i < 2; i++) {
    const sp = nearestWalkable(G.map, t.x + (i ? 1 : -1), t.y + 1, 4, (x, y) => taken.has(x + y * MAP_W));
    if (!sp) continue;
    taken.add(sp.x + sp.y * MAP_W);
    const s = spawnUnit(type, u.owner, sp.x, sp.y);
    s.facing = u.facing;
    G.effects.push({ type: 'summon', x: s.x, y: s.y, t: 0.9, faction });
    out.push(s);
  }
  u.atkAnim = 0.3;
  if (u.owner === G.human) sfx('summon');
  return out;
}

function castStorm(u, tx, ty) {
  const sp = SPELLS.storm;
  u.mana -= sp.mana;
  const faction = G.players[u.owner].faction;
  const thor = faction === 'vikings';
  G.areas.push({
    x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, r: sp.radius * TILE, owner: u.owner, src: u.id,
    kind: thor ? 'storm' : 'blizzard', ticks: thor ? 4 : 8, interval: thor ? 0.45 : 0.5, t: 0.2, dmg: thor ? 15 : 8, age: 0,
  });
  u.atkAnim = 0.3;
  if (u.owner === G.human || tileVisible(tx * TILE, ty * TILE)) sfx(thor ? 'thunder' : 'wind');
}

function updateAreas(dt) {
  for (const a of G.areas) {
    a.age += dt;
    a.t -= dt;
    if (a.t > 0) continue;
    a.t = a.interval;
    a.ticks--;
    const src = { id: a.src, owner: a.owner, type: 'caster' };
    for (const e of G.ents) {
      if (e.dead || e.hidden || e.owner < 0 || e.owner === a.owner) continue;
      let d;
      if (e.kind === 'bldg') {
        const cx = Math.max(e.tx * TILE, Math.min(a.x, (e.tx + e.w) * TILE));
        const cy = Math.max(e.ty * TILE, Math.min(a.y, (e.ty + e.h) * TILE));
        d = Math.hypot(a.x - cx, a.y - cy);
      } else d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d > a.r) continue;
      // Spell damage ignores armor; buildings take half.
      damage(src, e, a.dmg + armorOf(e), e.kind === 'bldg' ? 0.5 : 1);
    }
    if (a.kind === 'storm') {
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * a.r * 0.8;
      G.effects.push({ type: 'bolt', x: a.x + Math.cos(ang) * rr, y: a.y + Math.sin(ang) * rr, t: 0.25, seed: Math.random() * 1000 });
      if (tileVisible(a.x, a.y)) sfx('zap');
    }
  }
  G.areas = G.areas.filter(a => a.ticks > 0);
}

function doCast(u, dt, o) {
  const sp = SPELLS[o.spell];
  if (!spellReady(u, o.spell)) {
    if (u.owner === G.human) msg(u.mana < sp.mana ? 'Not enough mana.' : 'That spell has not been learned yet.');
    u.order = null;
    return;
  }
  if (o.spell === 'summon') { castSummon(u); u.order = null; return; }
  let rect;
  if (o.spell === 'heal') {
    const t = G.byId.get(o.target);
    if (!alive(t) || t.hidden || t.hp >= t.maxHp) { u.order = null; return; }
    rect = entRect(t);
  } else rect = { x: o.x, y: o.y, w: 1, h: 1 };
  const ut = tileOf(u);
  if (rectDist(ut.x, ut.y, rect) <= sp.range) {
    u.path = null;
    if (o.spell === 'heal') castHeal(u, G.byId.get(o.target));
    else castStorm(u, o.x, o.y);
    u.order = null;
    return;
  }
  o.repath = (o.repath || 0) - dt;
  if (!u.path || u.pathI >= u.path.length || o.repath <= 0) {
    const r = unitGoal(u, { ...rect, range: sp.range });
    o.repath = 0.8;
    if (!r.path.length && !r.reached) { u.order = null; return; }
  }
  stepMove(u, dt);
}

function cmdCast(units, spell, target) {
  // Pick the caster best able to cast: enough mana, closest to the target.
  const casters = units.filter(u => u.kind === 'unit' && !u.dead && !u.hidden && u.mana != null && spellReady(u, spell));
  if (!casters.length) return 'No spellcaster has enough mana.';
  let tx, ty;
  if (target && target.id) { tx = target.x; ty = target.y; }
  else if (target) { tx = target.x * TILE; ty = target.y * TILE; }
  else { tx = casters[0].x; ty = casters[0].y; }
  casters.sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
  const u = casters[0];
  u.hold = false;
  u.path = null;
  if (spell === 'summon') { castSummon(u); return null; }
  if (spell === 'heal') u.order = { type: 'cast', spell, target: target.id };
  else u.order = { type: 'cast', spell, x: target.x, y: target.y };
  return null;
}

// ---------- projectiles, effects ----------

function updateProjectiles(dt) {
  for (const pr of G.projectiles) {
    const t = G.byId.get(pr.target);
    if (pr.kind === 'arrow' && alive(t) && !t.hidden) { pr.tx = t.x; pr.ty = t.y; }
    const dx = pr.tx - pr.x, dy = pr.ty - pr.y;
    const dist = Math.hypot(dx, dy);
    const step = pr.speed * dt;
    if (dist <= step) {
      pr.done = true;
      const src = { id: pr.src, owner: pr.owner, type: pr.srcType };
      if (pr.splash) {
        G.effects.push({ type: 'boom', x: pr.tx, y: pr.ty, t: 0.5, r: pr.splash * TILE });
        sfx('thud');
        const R = pr.splash * TILE;
        for (const e of G.ents) {
          if (e.dead || e.hidden || e.type === 'mine') continue;
          let d;
          if (e.kind === 'bldg') {
            const cx = Math.max(e.tx * TILE, Math.min(pr.tx, (e.tx + e.w) * TILE));
            const cy = Math.max(e.ty * TILE, Math.min(pr.ty, (e.ty + e.h) * TILE));
            d = Math.hypot(pr.tx - cx, pr.ty - cy);
          } else d = Math.hypot(e.x - pr.tx, e.y - pr.ty);
          if (d <= R) damage(src, e, pr.dmg, e.id === pr.target ? 1 : 0.6);
        }
      } else if (alive(t) && !t.hidden) {
        damage(src, t, pr.dmg);
      }
    } else {
      pr.x += dx / dist * step;
      pr.y += dy / dist * step;
    }
  }
  G.projectiles = G.projectiles.filter(p => !p.done);
}

function separateUnits() {
  // Workers on a gathering trip pass through each other, as in the classics.
  const busy = u => u.type === 'worker' && u.order && (u.order.type === 'gold' || u.order.type === 'wood' || u.order.type === 'build' || u.order.type === 'repair');
  const us = G.ents.filter(e => e.kind === 'unit' && !e.dead && !e.hidden && !busy(e));
  const R = 14;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      let d = Math.hypot(dx, dy);
      if (d >= R) continue;
      if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
      const push = (R - d) * 0.25;
      const nx = dx / d * push, ny = dy / d * push;
      // Only units standing still get nudged aside; anything walking keeps
      // walking, so units can never shove each other into a standstill.
      const aMoving = a.path && a.pathI < a.path.length;
      const bMoving = b.path && b.pathI < b.path.length;
      if (!aMoving) tryShift(a, -nx, -ny);
      if (!bMoving) tryShift(b, nx, ny);
    }
  }
}

function tryShift(u, dx, dy) {
  const nx = u.x + dx, ny = u.y + dy;
  if (G.map.isWalkable(Math.floor(nx / TILE), Math.floor(ny / TILE))) { u.x = nx; u.y = ny; }
}

function updateVisibility() {
  G.vis.fill(0);
  const map = G.map;
  for (const e of G.ents) {
    if (e.dead || e.owner !== G.human) continue;
    const d = defOf(e);
    const r = d.sight || 3;
    let cx, cy, hw = 0, hh = 0;
    if (e.kind === 'bldg') { cx = e.tx; cy = e.ty; hw = e.w - 1; hh = e.h - 1; }
    else { const t = tileOf(e); cx = t.x; cy = t.y; }
    for (let y = cy - r; y <= cy + hh + r; y++) {
      if (y < 0 || y >= map.h) continue;
      for (let x = cx - r; x <= cx + hw + r; x++) {
        if (x < 0 || x >= map.w) continue;
        const dx = x < cx ? cx - x : x > cx + hw ? x - cx - hw : 0;
        const dy = y < cy ? cy - y : y > cy + hh ? y - cy - hh : 0;
        if (dx * dx + dy * dy > r * r + r) continue;
        const i = y * map.w + x;
        G.vis[i] = 1;
        G.explored[i] = 1;
      }
    }
  }
}

function isVisibleEnt(e) {
  if (G.revealAll || e.owner === G.human) return true;
  if (e.kind === 'bldg') {
    for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (G.explored[G.map.idx(x, y)]) return true;
    return false;
  }
  const t = tileOf(e);
  return !!G.vis[G.map.idx(t.x, t.y)];
}

function tileVisible(px, py) {
  if (G.revealAll) return true;
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (!G.map.inBounds(x, y)) return false;
  return !!G.vis[y * MAP_W + x];
}

function checkVictory() {
  if (G.over) return;
  const aliveP = G.players.map(p => G.ents.some(e => !e.dead && e.owner === p.id));
  if (!aliveP[G.human]) { G.over = 'defeat'; sfx('defeat'); }
  else if (G.tut || G.mission) return; // scripted modes decide when they are won
  else if (aliveP.every((a, i) => i === G.human || !a)) { G.over = 'victory'; sfx('victory'); }
}

// ---------- main tick ----------

function tick(dt) {
  G.time += dt;
  G.attackMsgT -= dt;
  if (G.combatT > 0) G.combatT -= dt;
  for (const e of G.ents) {
    if (e.dead) continue;
    if (e.kind === 'unit') updateUnit(e, dt);
    else if (e.owner >= 0) updateBuilding(e, dt);
  }
  updateProjectiles(dt);
  updateAreas(dt);
  separateUnits();
  for (const fx of G.effects) fx.t -= dt;
  G.effects = G.effects.filter(f => f.t > 0);
  if (G.ents.some(e => e.dead)) {
    G.ents = G.ents.filter(e => {
      if (e.dead) G.byId.delete(e.id);
      return !e.dead;
    });
    updateFood();
  }
  if (G.ai) G.ai.update(dt);
  if (G.ai2) G.ai2.update(dt);
  G.visT -= dt;
  if (G.visT <= 0) { G.visT = 0.2; updateVisibility(); }
  G.checkT -= dt;
  if (G.checkT <= 0) { G.checkT = 1; checkVictory(); }
  for (const m of G.msgs) m.t -= dt;
  G.msgs = G.msgs.filter(m => m.t > 0);
}

// Sound hook; replaced by the audio module when present.
function sfx() {}
