'use strict';
// Input handling, camera, selection, sidebar panels and command card.

const UI = {
  selected: new Set(), hover: null, placing: null, placer: null, targeting: null,
  drag: null, pan: null, mouse: { x: -1, y: -1, in: false }, mouseWorld: null,
  groups: {}, lastGroup: { n: -1, t: 0 }, menu: 'main', cam: { x: 0, y: 0 }, vw: 800, vh: 600,
  keys: {}, sig: '', liveEls: [], tipFor: null,
};

const $ = id => document.getElementById(id);

function clampCam() {
  UI.cam.x = Math.max(0, Math.min(MAP_W * TILE - UI.vw, UI.cam.x));
  UI.cam.y = Math.max(0, Math.min(MAP_H * TILE - UI.vh, UI.cam.y));
  if (UI.vw > MAP_W * TILE) UI.cam.x = (MAP_W * TILE - UI.vw) / 2;
  if (UI.vh > MAP_H * TILE) UI.cam.y = (MAP_H * TILE - UI.vh) / 2;
}

function centerOn(x, y) {
  UI.cam.x = x - UI.vw / 2;
  UI.cam.y = y - UI.vh / 2;
  clampCam();
}

function toWorld(sx, sy) { return { x: sx + UI.cam.x, y: sy + UI.cam.y }; }

function entityAt(wx, wy) {
  let best = null, bd = 1e9;
  for (const e of G.ents) {
    if (e.dead || e.hidden || e.kind !== 'unit' || !isVisibleEnt(e)) continue;
    const d = Math.hypot(e.x - wx, e.y - 2 - wy);
    const r = e.type === 'rider' || e.type === 'siege' ? 16 : 12;
    if (d < r && d < bd) { bd = d; best = e; }
  }
  if (best) return best;
  for (const e of G.ents) {
    if (e.dead || e.kind !== 'bldg' || !isVisibleEnt(e)) continue;
    if (wx >= e.tx * TILE && wx < (e.tx + e.w) * TILE && wy >= e.ty * TILE && wy < (e.ty + e.h) * TILE) return e;
  }
  return null;
}

function ownSelected() { return [...UI.selected].filter(e => e.owner === G.human && !e.dead); }
function selUnits() { return ownSelected().filter(e => e.kind === 'unit' && !e.hidden); }
function selWorkers() { return selUnits().filter(e => e.type === 'worker'); }

function setSelection(list, add) {
  if (!add) UI.selected.clear();
  for (const e of list) UI.selected.add(e);
  UI.menu = 'main';
  UI.targeting = null;
  if (list.length && list[0].owner === G.human) {
    const e = list[0];
    if (e.kind === 'unit') sfx('select');
  }
}

function cleanSelection() {
  for (const e of UI.selected) if (e.dead || e.hidden) UI.selected.delete(e);
  for (const k in UI.groups) UI.groups[k] = UI.groups[k].filter(e => !e.dead);
}

// ---------- commands from the map ----------

function marker(x, y, color) { G.effects.push({ type: 'marker', x, y: y + 8, t: 0.6, color }); }

function rightClickAt(w) {
  if (UI.placing || UI.targeting) { UI.placing = null; UI.targeting = null; return; }
  const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
  if (!G.map.inBounds(tx, ty)) return;
  const units = selUnits();
  const own = ownSelected();
  const target = entityAt(w.x, w.y);
  if (!units.length) {
    const bs = own.filter(e => e.kind === 'bldg' && BUILDINGS[e.type].trains);
    for (const b of bs) b.rally = { x: tx, y: ty };
    if (bs.length) marker(w.x, w.y, '#5cf05c');
    return;
  }
  const workers = units.filter(u => u.type === 'worker');
  const others = units.filter(u => u.type !== 'worker');
  if (target && isEnemy(units[0], target)) {
    cmdAttack(units, target);
    marker(target.x, target.y, '#ff5040');
    sfx('ack');
    return;
  }
  if (workers.length) {
    if (target && target.type === 'mine') {
      cmdGather(workers, target, null);
      if (others.length) cmdMove(others, tx, ty, false);
      marker(w.x, w.y, '#e8d050');
      sfx('ack');
      return;
    }
    if (G.map.isForest(tx, ty) && (G.explored[G.map.idx(tx, ty)] || G.revealAll)) {
      cmdGather(workers, null, { x: tx, y: ty });
      if (others.length) cmdMove(others, tx, ty, false);
      marker(w.x, w.y, '#e8d050');
      sfx('ack');
      return;
    }
    if (target && target.kind === 'bldg' && target.owner === G.human && !target.built) {
      const w0 = workers[0];
      if (!target.builder || !alive(G.byId.get(target.builder))) {
        w0.order = { type: 'build', bid: target.id };
        w0.path = null;
      }
      marker(w.x, w.y, '#5cf05c');
      return;
    }
    if (target && target.kind === 'bldg' && target.owner === G.human && target.built) {
      const d = BUILDINGS[target.type];
      const carriers = workers.filter(u => u.carry && d.dropoff && d.dropoff.includes(u.carry.res));
      if (carriers.length) {
        cmdReturn(carriers);
        const rest = units.filter(u => !carriers.includes(u));
        if (rest.length) cmdMove(rest, tx, ty, false);
        marker(w.x, w.y, '#5cf05c');
        return;
      }
    }
  }
  cmdMove(units, tx, ty, false);
  marker(w.x, w.y, '#5cf05c');
  sfx('ack');
}

function applyTargeting(w) {
  const mode = UI.targeting;
  UI.targeting = null;
  const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
  if (!G.map.inBounds(tx, ty)) return;
  const units = selUnits();
  if (!units.length) return;
  const target = entityAt(w.x, w.y);
  if (mode === 'move') { cmdMove(units, tx, ty, false); marker(w.x, w.y, '#5cf05c'); }
  else if (mode === 'attack') {
    if (target && target !== units[0] && target.type !== 'mine' && target.owner >= 0) cmdAttack(units, target);
    else cmdMove(units, tx, ty, true);
    marker(w.x, w.y, '#ff5040');
  } else if (mode === 'gather') {
    const ws = units.filter(u => u.type === 'worker');
    if (target && target.type === 'mine') cmdGather(ws, target, null);
    else if (G.map.isForest(tx, ty)) cmdGather(ws, null, { x: tx, y: ty });
    else { msg('Choose a gold mine or a forest.'); return; }
    marker(w.x, w.y, '#e8d050');
  }
  sfx('ack');
}

function tryPlace(w, keep) {
  const type = UI.placing;
  const d = BUILDINGS[type];
  const tx = Math.floor(w.x / TILE - d.w / 2 + 0.5), ty = Math.floor(w.y / TILE - d.h / 2 + 0.5);
  if (!alive(UI.placer) || UI.placer.hidden) {
    const ws = selWorkers();
    UI.placer = ws[0] || null;
    if (!UI.placer) { UI.placing = null; return; }
  }
  const r = cmdBuild(UI.placer, type, tx, ty);
  if (typeof r === 'string') { msg(r); sfx('error'); return; }
  sfx('place');
  if (keep) {
    const next = selWorkers().find(u => u !== UI.placer && !(u.order && u.order.type === 'build'));
    if (next) { UI.placer = next; return; }
  }
  UI.placing = null;
  UI.menu = 'main';
}

// ---------- command card ----------

function costText(d) {
  const parts = [];
  if (d.gold) parts.push(`<span class="g">${d.gold}</span>`);
  if (d.wood) parts.push(`<span class="w">${d.wood}</span>`);
  return parts.join(' ');
}

function getCommands() {
  const own = ownSelected();
  const p = humanPlayer();
  const f = p.faction;
  if (!own.length) return [];
  const cmds = [];
  const units = own.filter(e => e.kind === 'unit');
  if (units.length) {
    const workers = units.filter(u => u.type === 'worker');
    if (UI.menu === 'build' && workers.length) {
      for (const t of BUILD_ORDER) {
        const d = BUILDINGS[t];
        const ok = reqsMet(p.id, d.req);
        cmds.push({
          key: d.hotkey, icon: { kind: 'bldg', type: t }, name: bldgName(t, f), cost: d,
          desc: d.desc + (ok ? '' : ` <em>Requires ${d.req.map(r => bldgName(r, f)).join(', ')}.</em>`),
          disabled: !ok, poor: !canAfford(p, d),
          act: () => {
            if (!canAfford(p, d)) { msg(p.gold < d.gold ? 'Not enough gold.' : 'Not enough lumber.'); sfx('error'); return; }
            UI.placing = t;
            UI.placer = workers[0];
          },
        });
      }
      cmds.push({ key: 'Escape', label: 'Esc', glyph: '↩', name: 'Back', act: () => { UI.menu = 'main'; UI.placing = null; }, slot: 8 });
      return cmds;
    }
    cmds.push({ key: 'M', glyph: '➜', name: 'Move', desc: 'Move to a location.', act: () => { UI.targeting = 'move'; } });
    cmds.push({ key: 'S', glyph: '✋', name: 'Stop', desc: 'Stop all actions.', act: () => cmdStop(units) });
    cmds.push({ key: 'A', glyph: '⚔', name: 'Attack', desc: 'Attack a target, or attack-move to a location fighting anything on the way.', act: () => { UI.targeting = 'attack'; } });
    if (units.some(u => u.type !== 'worker')) {
      cmds.push({ key: 'H', glyph: '⛨', name: 'Hold Position', desc: 'Stand ground and only attack enemies in range.', act: () => cmdHold(units) });
    }
    if (workers.length) {
      cmds.push({ key: 'G', glyph: '⛏', name: 'Gather', desc: 'Mine gold or chop lumber. (Right-click a mine or forest.)', act: () => { UI.targeting = 'gather'; } });
      if (workers.some(u => u.carry)) cmds.push({ key: 'R', glyph: '⤺', name: 'Return Goods', desc: 'Carry resources back to the nearest drop-off.', act: () => cmdReturn(workers) });
      cmds.push({ key: 'B', glyph: '⚒', name: 'Build', desc: 'Construct a building.', act: () => { UI.menu = 'build'; } });
    }
    return cmds;
  }
  // Buildings: act on the selected building with the shortest queue.
  const bldgs = own.filter(e => e.kind === 'bldg');
  const type = bldgs[0].type;
  const same = bldgs.filter(b => b.type === type);
  const pickB = () => same.filter(b => b.built).sort((a, b) => a.queue.length - b.queue.length)[0];
  const b0 = same[0];
  const d = BUILDINGS[type];
  if (b0.built) {
    for (const ut of d.trains || []) {
      const ud = UNITS[ut];
      const ok = reqsMet(p.id, ud.req);
      cmds.push({
        key: ud.hotkey, icon: { kind: 'unit', type: ut }, name: unitName(ut, f), cost: ud,
        desc: ud.desc + (ok ? '' : ` <em>Requires ${ud.req.map(r => bldgName(r, f)).join(', ')}.</em>`),
        stats: ud, disabled: !ok, poor: !canAfford(p, ud),
        act: () => { const b = pickB(); const r = b && cmdTrain(b, ut); if (r) { msg(r); sfx('error'); } else sfx('click'); },
      });
    }
    for (const key of d.research || []) {
      const rd = RESEARCH[key];
      const st = researchState(p.id, key);
      if (st === 'done') continue;
      cmds.push({
        key: rd.hotkey, glyph: key === 'weapons' ? '🗡' : key === 'armor' ? '🛡' : '➶', name: rd.name, cost: rd, desc: rd.desc,
        disabled: st !== 'open', poor: !canAfford(p, rd),
        act: () => { const b = pickB(); const r = b && cmdResearch(b, key); if (r) { msg(r); sfx('error'); } else sfx('click'); },
      });
    }
  }
  if (!b0.built || same.some(b => b.queue.length)) {
    cmds.push({
      key: 'Escape', label: 'Esc', glyph: '✖', name: b0.built ? 'Cancel' : 'Cancel Construction',
      desc: b0.built ? 'Cancel the last item in the queue (full refund).' : 'Tear down the site (75% refund).',
      act: () => {
        const b = b0.built ? same.filter(x => x.queue.length).sort((a, c) => c.queue.length - a.queue.length)[0] : b0;
        if (b) cmdCancel(b);
      }, slot: 8,
    });
  }
  return cmds;
}

function commandSig() {
  const p = humanPlayer();
  const parts = [UI.menu, UI.targeting || '', UI.placing || ''];
  for (const e of UI.selected) {
    parts.push(e.id, e.owner, e.built ? 1 : 0, e.hidden ? 1 : 0, e.carry ? e.carry.res : '');
    if (e.kind === 'bldg') parts.push(e.queue.map(q => q.unit || q.research).join(','));
  }
  for (const t of BUILD_ORDER) parts.push(hasBuilt(G.human, t) ? 1 : 0);
  parts.push(p.up.weapons, p.up.armor, p.up.arrows);
  parts.push(Math.floor(p.gold / 10), Math.floor(p.wood / 10));
  return parts.join('|');
}

function rebuildPanels() {
  cleanSelection();
  const sig = commandSig();
  if (sig === UI.sig) return;
  UI.sig = sig;
  buildCommandCard();
  buildInfoPanel();
}

function buildCommandCard() {
  const el = $('commands');
  el.innerHTML = '';
  const cmds = getCommands();
  UI.cmds = cmds;
  const p = humanPlayer();
  const slots = new Array(9).fill(null);
  let i = 0;
  for (const c of cmds) {
    if (c.slot != null) slots[c.slot] = c;
    else { while (slots[i]) i++; if (i < 9) slots[i++] = c; }
  }
  for (const c of slots) {
    const b = document.createElement('button');
    b.className = 'cmd';
    if (!c) { b.disabled = true; b.classList.add('empty'); el.appendChild(b); continue; }
    if (c.disabled) b.classList.add('locked');
    if (c.poor) b.classList.add('poor');
    if (c.icon) {
      const cv = document.createElement('canvas');
      cv.width = 44; cv.height = 44;
      drawIcon(cv, c.icon.kind, c.icon.type, p.faction, p.color);
      b.appendChild(cv);
    } else {
      const s = document.createElement('span');
      s.className = 'glyph';
      s.textContent = c.glyph;
      b.appendChild(s);
    }
    const k = document.createElement('span');
    k.className = 'hk';
    k.textContent = c.label || c.key;
    b.appendChild(k);
    b.addEventListener('click', ev => { ev.stopPropagation(); if (!c.disabled) { c.act(); UI.sig = ''; } else sfx('error'); });
    b.addEventListener('mouseenter', () => showTip(c));
    b.addEventListener('mouseleave', hideTip);
    el.appendChild(b);
  }
}

function showTip(c) {
  const t = $('tip');
  let h = `<b>${c.name}</b> <span class="key">[${c.label || c.key}]</span>`;
  if (c.cost) h += `<div class="cost">${costText(c.cost)}${c.cost.time ? ` <span class="t">${c.cost.time}s</span>` : ''}</div>`;
  if (c.desc) h += `<div>${c.desc}</div>`;
  if (c.stats) {
    const s = c.stats;
    h += `<div class="stats">HP ${s.hp} · Atk ${s.atk} · Armor ${s.armor} · Range ${s.range}</div>`;
  }
  t.innerHTML = h;
  t.style.display = 'block';
}
function hideTip() { $('tip').style.display = 'none'; }

function buildInfoPanel() {
  const el = $('info');
  el.innerHTML = '';
  UI.liveEls = [];
  const sel = [...UI.selected];
  if (!sel.length) {
    el.innerHTML = `<div class="hint">Select units with left-click or drag a box.<br>Right-click to move, attack, gather.<br>Press <b>F1</b> for help.</div>`;
    return;
  }
  if (sel.length === 1) {
    const e = sel[0];
    const f = e.owner >= 0 ? G.players[e.owner].faction : 'vikings';
    const color = e.owner >= 0 ? G.players[e.owner].color : '#e8c547';
    const top = document.createElement('div');
    top.className = 'single';
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 56;
    drawIcon(cv, e.kind, e.type, f, color);
    top.appendChild(cv);
    const txt = document.createElement('div');
    txt.className = 'meta';
    const owner = e.owner < 0 ? 'Neutral' : e.owner === G.human ? 'Yours' : FACTIONS[f].short;
    txt.innerHTML = `<div class="nm">${nameOf(e)}</div><div class="own">${owner}</div>`;
    const hp = document.createElement('div');
    hp.className = 'hpt';
    txt.appendChild(hp);
    top.appendChild(txt);
    el.appendChild(top);
    if (e.type === 'mine') {
      UI.liveEls.push(() => { hp.textContent = `Gold left: ${e.gold}`; });
    } else {
      UI.liveEls.push(() => { hp.textContent = `HP ${Math.ceil(e.hp)} / ${e.maxHp}`; });
      const d = defOf(e);
      const st = document.createElement('div');
      st.className = 'stats';
      if (e.kind === 'unit') {
        st.innerHTML = `Attack ${atkOf(e)} · Armor ${armorOf(e)}<br>Range ${d.range} · Sight ${d.sight} · Speed ${d.speed}`;
        if (e.carry) st.innerHTML += `<br>Carrying ${e.carry.amt} ${e.carry.res === 'gold' ? 'gold' : 'lumber'}`;
      } else {
        st.innerHTML = `Armor ${armorOf(e)}` + (d.atk ? ` · Attack ${atkOf(e)} · Range ${d.range}` : '') + (d.food ? ` · Food +${d.food}` : '');
      }
      el.appendChild(st);
      if (e.kind === 'bldg' && (!e.built || e.queue.length)) {
        const box = document.createElement('div');
        box.className = 'queue';
        const bar = document.createElement('div');
        bar.className = 'pbar';
        const fill = document.createElement('div');
        bar.appendChild(fill);
        const label = document.createElement('div');
        label.className = 'plabel';
        box.appendChild(label);
        box.appendChild(bar);
        if (e.built && e.queue.length) {
          const row = document.createElement('div');
          row.className = 'qrow';
          e.queue.forEach((q, i) => {
            const c = document.createElement('canvas');
            c.width = 30; c.height = 30;
            if (q.unit) drawIcon(c, 'unit', q.unit, f, color);
            else { const x = c.getContext('2d'); x.fillStyle = '#2a333a'; x.fillRect(0, 0, 30, 30); x.fillStyle = '#e8d8a8'; x.font = '18px serif'; x.textAlign = 'center'; x.fillText('ᚱ', 15, 21); }
            c.title = i === 0 ? 'In progress' : 'Queued';
            row.appendChild(c);
          });
          box.appendChild(row);
        }
        el.appendChild(box);
        UI.liveEls.push(() => {
          if (!e.built) { label.textContent = 'Under construction' + (e.builder ? '' : ' (no worker)'); fill.style.width = (e.progress * 100) + '%'; return; }
          const q = e.queue[0];
          if (!q) { label.textContent = ''; fill.style.width = '0'; return; }
          const nm = q.unit ? unitName(q.unit, f) : RESEARCH[q.research].name;
          const blocked = q.unit && !q.started;
          label.textContent = blocked ? `${nm} — waiting for food` : `${q.unit ? 'Training' : 'Researching'} ${nm}`;
          fill.style.width = (q.t / q.time * 100) + '%';
        });
      }
    }
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'multi';
  for (const e of sel.slice(0, 16)) {
    const f = G.players[e.owner] ? G.players[e.owner].faction : 'vikings';
    const color = e.owner >= 0 ? G.players[e.owner].color : '#e8c547';
    const c = document.createElement('canvas');
    c.width = 36; c.height = 36;
    drawIcon(c, e.kind, e.type, f, color);
    const wrap = document.createElement('div');
    wrap.className = 'mi';
    wrap.appendChild(c);
    const bar = document.createElement('div');
    bar.className = 'mhp';
    wrap.appendChild(bar);
    wrap.title = nameOf(e);
    wrap.addEventListener('click', ev => {
      if (ev.shiftKey) UI.selected.delete(e);
      else setSelection([e]);
      UI.sig = '';
    });
    grid.appendChild(wrap);
    UI.liveEls.push(() => {
      const fr = e.hp / e.maxHp;
      bar.style.width = (fr * 100) + '%';
      bar.style.background = fr > 0.6 ? '#4ccf4c' : fr > 0.3 ? '#e2c23a' : '#e2463a';
    });
  }
  el.appendChild(grid);
  if (sel.length > 16) {
    const more = document.createElement('div');
    more.className = 'hint';
    more.textContent = `+${sel.length - 16} more`;
    el.appendChild(more);
  }
}

function updateLive() {
  for (const f of UI.liveEls) f();
  const p = humanPlayer();
  $('gold').textContent = Math.floor(p.gold);
  $('wood').textContent = Math.floor(p.wood);
  $('food').textContent = `${p.food} / ${p.foodCap}`;
  $('food').parentElement.classList.toggle('warn', p.food >= p.foodCap);
  const t = Math.floor(G.time);
  $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const m = $('msgs');
  const html = G.msgs.map(x => `<div style="opacity:${Math.min(1, x.t)}">${x.text}</div>`).join('');
  if (m.innerHTML !== html) m.innerHTML = html;
  const view = $('view');
  view.style.cursor = UI.targeting ? 'crosshair' : UI.placing ? 'copy' : (UI.hover && UI.hover.owner >= 0 && UI.hover.owner !== G.human && selUnits().length ? 'crosshair' : 'default');
  $('mode').textContent = UI.targeting ? { move: 'Choose destination', attack: 'Choose target', gather: 'Choose a mine or forest' }[UI.targeting] + ' — Esc to cancel'
    : UI.placing ? `Place ${bldgName(UI.placing, p.faction)} — Shift to place several, Esc to cancel` : '';
}

// ---------- input wiring ----------

function initInput() {
  const view = $('view');
  view.addEventListener('contextmenu', e => e.preventDefault());
  $('minimap').addEventListener('contextmenu', e => e.preventDefault());

  view.addEventListener('mousedown', e => {
    if (G.over || G.paused) return;
    const r = view.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const w = toWorld(sx, sy);
    if (e.button === 0) {
      if (UI.placing) return tryPlace(w, e.shiftKey);
      if (UI.targeting) return applyTargeting(w);
      UI.drag = { x0: sx, y0: sy, x1: sx, y1: sy, active: false, shift: e.shiftKey };
    } else if (e.button === 2) {
      rightClickAt(w);
    } else if (e.button === 1) {
      e.preventDefault();
      UI.pan = { x: sx, y: sy, cx: UI.cam.x, cy: UI.cam.y };
    }
  });

  window.addEventListener('mousemove', e => {
    const r = view.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    UI.mouse.x = sx; UI.mouse.y = sy;
    UI.mouse.in = sx >= 0 && sy >= 0 && sx < r.width && sy < r.height;
    UI.mouseWorld = toWorld(sx, sy);
    if (UI.drag) {
      UI.drag.x1 = sx; UI.drag.y1 = sy;
      if (Math.abs(sx - UI.drag.x0) + Math.abs(sy - UI.drag.y0) > 6) UI.drag.active = true;
    }
    if (UI.pan) {
      UI.cam.x = UI.pan.cx - (sx - UI.pan.x);
      UI.cam.y = UI.pan.cy - (sy - UI.pan.y);
      clampCam();
    }
  });

  window.addEventListener('mouseup', e => {
    if (e.button === 1) UI.pan = null;
    if (e.button !== 0 || !UI.drag) return;
    const d = UI.drag;
    UI.drag = null;
    if (d.active) {
      const a = toWorld(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
      const b = toWorld(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
      const inBox = G.ents.filter(u => !u.dead && !u.hidden && u.kind === 'unit' && u.owner === G.human &&
        u.x >= a.x - 6 && u.x <= b.x + 6 && u.y >= a.y - 6 && u.y <= b.y + 6);
      if (inBox.length) setSelection(inBox, d.shift);
      else if (!d.shift) {
        const bl = G.ents.filter(u => !u.dead && u.kind === 'bldg' && u.owner === G.human &&
          u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y);
        setSelection(bl.slice(0, 1), false);
      }
    } else {
      const w = toWorld(d.x0, d.y0);
      const e2 = entityAt(w.x, w.y);
      if (e2) {
        if (d.shift && e2.owner === G.human && e2.kind === 'unit') {
          if (UI.selected.has(e2)) UI.selected.delete(e2); else UI.selected.add(e2);
          for (const s of [...UI.selected]) if (s.owner !== G.human || s.kind !== 'unit') UI.selected.delete(s);
        } else setSelection([e2]);
      } else if (!d.shift) setSelection([]);
    }
    UI.sig = '';
  });

  view.addEventListener('dblclick', e => {
    const r = view.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    const t = entityAt(w.x, w.y);
    if (!t || t.owner !== G.human) return;
    const same = G.ents.filter(u => !u.dead && !u.hidden && u.owner === G.human && u.type === t.type && u.kind === t.kind &&
      u.x >= UI.cam.x && u.x <= UI.cam.x + UI.vw && u.y >= UI.cam.y && u.y <= UI.cam.y + UI.vh);
    setSelection(t.kind === 'unit' ? same : [t]);
    UI.sig = '';
  });

  view.addEventListener('wheel', e => {
    e.preventDefault();
    UI.cam.x += e.deltaX;
    UI.cam.y += e.deltaY;
    clampCam();
  }, { passive: false });

  const mm = $('minimap');
  const mmPos = e => {
    const r = mm.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * MAP_W * TILE, y: (e.clientY - r.top) / r.height * MAP_H * TILE };
  };
  let mmDrag = false;
  mm.addEventListener('mousedown', e => {
    if (G.over) return;
    const p = mmPos(e);
    if (e.button === 0) { mmDrag = true; centerOn(p.x, p.y); }
    else if (e.button === 2) rightClickAt(p);
  });
  window.addEventListener('mousemove', e => { if (mmDrag) { const p = mmPos(e); centerOn(p.x, p.y); } });
  window.addEventListener('mouseup', () => { mmDrag = false; });

  view.addEventListener('mouseleave', () => { UI.mouse.in = false; });

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { UI.keys[e.key] = false; });
  window.addEventListener('blur', () => { UI.keys = {}; UI.mouse.in = false; });
}

function onKey(e) {
  if (!G.map || $('title').style.display !== 'none') return;
  UI.keys[e.key] = true;
  if (e.key === 'F1') { e.preventDefault(); toggleHelp(); return; }
  if (e.key === 'F10' || e.key === 'p' || e.key === 'P') { if (!e.ctrlKey) { e.preventDefault(); togglePause(); return; } }
  if (G.over || G.paused) return;
  if (e.key === 'Escape') {
    if (UI.placing) { UI.placing = null; return; }
    if (UI.targeting) { UI.targeting = null; return; }
    if (UI.menu !== 'main') { UI.menu = 'main'; UI.sig = ''; return; }
  }
  if (/^[0-9]$/.test(e.key)) {
    const n = e.key;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      UI.groups[n] = ownSelected().filter(x => x.kind === 'unit' || UI.selected.size === 1);
      msg(`Group ${n} assigned.`);
    } else if (UI.groups[n] && UI.groups[n].length) {
      const g = UI.groups[n].filter(x => !x.dead);
      const now = performance.now();
      if (UI.lastGroup.n === n && now - UI.lastGroup.t < 350 && g.length) centerOn(g[0].x, g[0].y);
      UI.lastGroup = { n, t: now };
      setSelection(g.filter(x => !x.hidden));
      UI.sig = '';
    }
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    const s = ownSelected()[0];
    if (G.lastAttack && G.attackMsgT > 10) centerOn(G.lastAttack.x, G.lastAttack.y);
    else if (s) centerOn(s.x, s.y);
    return;
  }
  if (e.key === '.' ) {
    const idle = G.ents.filter(u => !u.dead && !u.hidden && u.owner === G.human && u.type === 'worker' && !u.order);
    if (idle.length) {
      UI.idleIdx = ((UI.idleIdx || 0) + 1) % idle.length;
      const u = idle[UI.idleIdx];
      setSelection([u]);
      centerOn(u.x, u.y);
      UI.sig = '';
    } else msg('No idle workers.');
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const cmds = UI.cmds || [];
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const c = cmds.find(c => c.key === key);
  if (c) {
    e.preventDefault();
    if (c.disabled) { sfx('error'); return; }
    c.act();
    UI.sig = '';
  }
}

function scrollCamera(dt) {
  const sp = 700 * dt;
  let dx = 0, dy = 0;
  if (UI.keys.ArrowLeft) dx -= sp;
  if (UI.keys.ArrowRight) dx += sp;
  if (UI.keys.ArrowUp) dy -= sp;
  if (UI.keys.ArrowDown) dy += sp;
  if (UI.mouse.in && !UI.drag && !UI.pan && document.hasFocus()) {
    const m = 8;
    if (UI.mouse.x < m) dx -= sp;
    if (UI.mouse.x > UI.vw - m) dx += sp;
    if (UI.mouse.y < m) dy -= sp;
    if (UI.mouse.y > UI.vh - m) dy += sp;
  }
  if (dx || dy) { UI.cam.x += dx; UI.cam.y += dy; clampCam(); }
}
