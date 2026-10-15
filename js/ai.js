'use strict';
// Computer opponent: runs its economy, builds a base, trains an army and attacks in waves.

const AI_PLAN = [
  ['barracks', 1], ['farm', 2], ['mill', 1], ['farm', 3], ['stable', 1], ['forge', 1],
  ['tower', 1], ['farm', 5], ['barracks', 2], ['tower', 2], ['farm', 7], ['farm', 9], ['farm', 11],
];

class AI {
  constructor(pid, diffKey) {
    this.pid = pid;
    this.diff = DIFFICULTY[diffKey] || DIFFICULTY.normal;
    this.t = 2;
    this.wave = this.diff.wave;
    this.waves = 0;
    this.threat = null;
    this.defendT = 0;
  }

  update(dt) {
    this.t -= dt;
    this.defendT -= dt;
    if (this.t > 0) return;
    this.t = this.diff.think;
    this.think();
  }

  alert(attacker) {
    this.threat = attacker.id;
    if (this.defendT <= 0) {
      this.defendT = 2;
      this.defend(attacker);
    }
  }

  onTrained(u) {
    if (u.type === 'worker') return;
    const hall = this.mainHall();
    if (hall) {
      const t = nearestWalkable(G.map, hall.tx + (this.pid === 0 ? 5 : -3), hall.ty + (this.pid === 0 ? 5 : -3), 6);
      if (t) cmdMove([u], t.x, t.y, true);
    }
  }

  mine() { return G.ents.filter(e => !e.dead && e.owner === this.pid); }

  mainHall() {
    const halls = G.ents.filter(e => !e.dead && e.owner === this.pid && e.type === 'hall');
    return halls.find(h => h.built) || halls[0] || null;
  }

  defend(attacker) {
    const hall = this.mainHall();
    if (!hall || !alive(attacker)) return;
    if (Math.hypot(attacker.x - hall.x, attacker.y - hall.y) > TILE * 16) return;
    const army = this.mine().filter(e => e.kind === 'unit' && e.type !== 'worker' && !e.hidden);
    for (const u of army) {
      if (u.order && u.order.type === 'attack') continue;
      if (Math.hypot(u.x - hall.x, u.y - hall.y) > TILE * 20) continue;
      cmdAttack([u], attacker);
    }
  }

  think() {
    if (G.over) return;
    const p = G.players[this.pid];
    const mine = this.mine();
    const units = mine.filter(e => e.kind === 'unit');
    const bldgs = mine.filter(e => e.kind === 'bldg');
    const workers = units.filter(u => u.type === 'worker');
    const army = units.filter(u => u.type !== 'worker');
    const count = t => bldgs.filter(b => b.type === t).length;
    const hall = this.mainHall();

    if (!hall) {
      const w = workers.find(w => !w.hidden);
      if (w && canAfford(p, BUILDINGS.hall)) {
        const s = G.map.starts[this.pid];
        const spot = this.findSpot('hall', s.x + 1, s.y + 1, w);
        if (spot) cmdBuild(w, 'hall', spot.x, spot.y);
      }
      this.sendArmy(army, true);
      return;
    }

    // Workers.
    const queuedWorkers = bldgs.reduce((n, b) => n + b.queue.filter(q => q.unit === 'worker').length, 0);
    if (hall.built && workers.length + queuedWorkers < this.diff.workers && hall.queue.length === 0 && canAfford(p, UNITS.worker)) {
      cmdTrain(hall, 'worker');
    }
    let goldN = workers.filter(w => w.order && w.order.type === 'gold').length;
    let woodN = workers.filter(w => w.order && w.order.type === 'wood').length;
    const goldShare = p.gold > p.wood * 2.5 + 200 ? 0.3 : p.wood > p.gold * 2 ? 0.75 : 0.5;
    const m = nearestMine(hall.x, hall.y);
    for (const w of workers) {
      if (w.order || w.hidden) continue;
      if (m && goldN < (goldN + woodN + 1) * goldShare) {
        cmdGather([w], m, null);
        goldN++;
      } else {
        cmdGather([w], null, null);
        woodN++;
      }
    }

    // Rebalance one worker per think when the stockpiles are lopsided.
    if (goldShare < 0.5 && goldN > woodN) {
      const w = workers.find(w => w.order && w.order.type === 'gold' && !w.hidden && !w.carry);
      if (w) cmdGather([w], null, null);
    } else if (goldShare > 0.5 && woodN > goldN && m) {
      const w = workers.find(w => w.order && w.order.type === 'wood' && !w.carry);
      if (w) cmdGather([w], m, null);
    }

    // Expand when the home mine is far away or gone.
    if (m && Math.hypot(m.x - hall.x, m.y - hall.y) > TILE * 12 && hall.built &&
        !bldgs.some(b => b.type === 'hall' && Math.hypot(m.x - b.x, m.y - b.y) < TILE * 12) && canAfford(p, BUILDINGS.hall)) {
      const w = this.pickBuilder(workers, m);
      const spot = w && this.findSpot('hall', m.tx + 1, m.ty + 1, w, 5);
      if (spot) cmdBuild(w, 'hall', spot.x, spot.y);
    }

    // Resume abandoned construction sites.
    for (const b of bldgs) {
      if (b.built || alive(G.byId.get(b.builder))) continue;
      if (workers.some(w => w.order && w.order.type === 'build' && w.order.bid === b.id)) continue;
      const w = this.pickBuilder(workers, b);
      if (w) { w.order = { type: 'build', bid: b.id }; w.path = null; w.carry = null; }
    }

    // Repair damaged buildings once the fighting nearby is over.
    if (p.gold > 100 && p.wood > 50) {
      for (const b of bldgs) {
        if (!b.built || b.hp >= b.maxHp * 0.9) continue;
        if (workers.some(w => w.order && w.order.type === 'repair' && w.order.bid === b.id)) continue;
        if (G.ents.some(e => !e.dead && e.kind === 'unit' && e.owner >= 0 && e.owner !== this.pid && Math.hypot(e.x - b.x, e.y - b.y) < TILE * 8)) continue;
        const w = this.pickBuilder(workers.filter(w => !(w.order && w.order.type === 'repair')), b);
        if (w) { cmdRepair([w], b); break; }
      }
    }

    // Construction.
    const building = bldgs.filter(b => !b.built).length;
    const maxParallel = this.diff.workers >= 12 ? 2 : 1;
    const need = this.nextBuilding(p, count, bldgs);
    let saving = false;
    if (need && building < maxParallel && hall.built) {
      if (canAfford(p, BUILDINGS[need])) {
        const w = this.pickBuilder(workers, hall);
        if (w) {
          const spot = this.findSpot(need, hall.tx + 1, hall.ty + 1, w);
          if (spot) cmdBuild(w, need, spot.x, spot.y);
        }
      } else saving = need === 'farm' || count('barracks') === 0;
    }

    // Research.
    for (const b of bldgs) {
      if (!b.built || b.queue.length) continue;
      const res = BUILDINGS[b.type].research || [];
      for (const key of res) {
        const r = RESEARCH[key];
        if (researchState(this.pid, key) === 'open' && p.gold >= r.gold + 250 && p.wood >= r.wood + 100) {
          cmdResearch(b, key);
          break;
        }
      }
    }

    // Army.
    if (!saving) {
      for (const b of bldgs) {
        if (b.type !== 'barracks' || !b.built || b.queue.length >= 2) continue;
        const type = this.pickUnit(p, army);
        if (type && canAfford(p, UNITS[type]) && p.food + b.queue.length < p.foodCap) cmdTrain(b, type);
      }
    }

    // Defense: enemies close to home.
    const threat = this.findThreat(hall);
    if (threat) {
      for (const u of army) {
        if (u.hidden || (u.order && u.order.type === 'attack')) continue;
        if (Math.hypot(u.x - hall.x, u.y - hall.y) > TILE * 22) continue;
        cmdAttack([u], threat);
      }
      return;
    }

    // Offense.
    const home = army.filter(u => Math.hypot(u.x - hall.x, u.y - hall.y) < TILE * 14);
    const idleHome = home.filter(u => !u.order || u.order.type === 'move');
    if (G.time > this.diff.firstAttack && idleHome.length >= this.wave) {
      this.sendArmy(idleHome, false);
      this.waves++;
      this.wave += this.diff.waveGrow;
    }
    // Units already out in the field keep pushing.
    const field = army.filter(u => !u.order && !u.hidden && Math.hypot(u.x - hall.x, u.y - hall.y) >= TILE * 14);
    if (field.length) this.sendArmy(field, false);
  }

  findThreat(hall) {
    let best = null, bd = TILE * 13;
    for (const e of G.ents) {
      if (e.dead || e.hidden || e.owner < 0 || e.owner === this.pid || e.kind !== 'unit') continue;
      const d = Math.hypot(e.x - hall.x, e.y - hall.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  sendArmy(units, any) {
    if (!units.length) return;
    const c = units[0];
    let best = null, bd = 1e9;
    for (const e of G.ents) {
      if (e.dead || e.owner < 0 || e.owner === this.pid || e.hidden) continue;
      if (!any && e.kind !== 'bldg' && G.ents.some(b => !b.dead && b.kind === 'bldg' && b.owner === e.owner)) continue;
      const d = Math.hypot(e.x - c.x, e.y - c.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    const r = entRect(best);
    cmdMove(units, r.x + Math.floor(r.w / 2), r.y + r.h, true);
  }

  nextBuilding(p, count, bldgs) {
    const farmBuilding = bldgs.some(b => b.type === 'farm' && !b.built);
    if (p.foodCap - p.food <= 2 && p.foodCap < MAX_FOOD && !farmBuilding && count('barracks') > 0) return 'farm';
    if (p.foodCap - p.food <= 1 && p.foodCap < MAX_FOOD && !farmBuilding) return 'farm';
    if (p.gold > 1500 && p.wood > 150 && count('barracks') > 0 && count('barracks') < 3) return 'barracks';
    for (const [t, n] of AI_PLAN) {
      if (count(t) < n) {
        if (t === 'farm' && p.foodCap - p.food > 6) continue;
        return reqsMet(this.pid, BUILDINGS[t].req) ? t : null;
      }
    }
    return null;
  }

  pickUnit(p, army) {
    const opts = [['melee', 4], ['ranged', 3], ['rider', 2], ['siege', 1]]
      .filter(([t]) => reqsMet(this.pid, UNITS[t].req));
    // Favor whatever is underrepresented relative to its weight.
    let best = null, bs = -1e9;
    const total = army.length + 1;
    for (const [t, w] of opts) {
      if (t === 'siege' && army.filter(u => u.type === 'siege').length >= 3) continue;
      const have = army.filter(u => u.type === t).length / total;
      const s = w / 10 - have + Math.random() * 0.15;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }

  pickBuilder(workers, hall) {
    const free = workers.filter(w => !w.hidden && !(w.order && w.order.type === 'build'));
    free.sort((a, b) => {
      const sa = (a.order && a.order.type === 'wood' ? 0 : 1) + (a.carry ? 1 : 0);
      const sb = (b.order && b.order.type === 'wood' ? 0 : 1) + (b.carry ? 1 : 0);
      return sa - sb || Math.hypot(a.x - hall.x, a.y - hall.y) - Math.hypot(b.x - hall.x, b.y - hall.y);
    });
    return free[0] || null;
  }

  findSpot(type, cx, cy, builder, minR = 3) {
    const d = BUILDINGS[type];
    const mines = G.ents.filter(e => !e.dead && e.type === 'mine');
    const hall = this.mainHall();
    for (let r = minR; r <= 16; r++) {
      const cands = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          cands.push({ x: cx + dx - Math.floor(d.w / 2), y: cy + dy - Math.floor(d.h / 2) });
        }
      }
      cands.sort(() => Math.random() - 0.5);
      for (const c of cands) {
        if (!canPlace(type, c.x, c.y, this.pid, builder)) continue;
        // Keep a free ring around the building so paths stay open.
        let ok = true;
        for (let y = c.y - 1; y <= c.y + d.h && ok; y++) {
          for (let x = c.x - 1; x <= c.x + d.w; x++) {
            if (!G.map.isGround(x, y) || G.map.bldg[G.map.idx(x, y)] !== 0) { ok = false; break; }
          }
        }
        if (!ok) continue;
        // Stay clear of gold mines and the path between hall and mine.
        for (const m of mines) {
          if (rectDist(c.x, c.y, { x: m.tx - 2 - d.w + 1, y: m.ty - 2 - d.h + 1, w: m.w + 4 + d.w - 1, h: m.h + 4 + d.h - 1 }) === 0) { ok = false; break; }
          if (hall && Math.hypot(m.x - hall.x, m.y - hall.y) < TILE * 10) {
            const minX = Math.min(m.tx, hall.tx), maxX = Math.max(m.tx + m.w, hall.tx + hall.w);
            const minY = Math.min(m.ty, hall.ty), maxY = Math.max(m.ty + m.h, hall.ty + hall.h);
            if (c.x < maxX && c.x + d.w > minX && c.y < maxY && c.y + d.h > minY) { ok = false; break; }
          }
        }
        if (ok) return c;
      }
    }
    return null;
  }
}
