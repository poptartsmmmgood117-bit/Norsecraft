'use strict';
// Saving and loading games in the browser's local storage.

const SAVE_KEYS = { manual: 'norsecraft.save.v1', auto: 'norsecraft.autosave.v1' };

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
function storageDel(key) {
  try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
}

function aiState(ai) {
  if (!ai) return null;
  return { pid: ai.pid, diffKey: ai.diffKey, diff: ai.diff, t: ai.t, wave: ai.wave, waves: ai.waves, defendT: ai.defendT };
}

function restoreAI(s) {
  if (!s) return null;
  const ai = new AI(s.pid, s.diffKey);
  Object.assign(ai, s);
  return ai;
}

function serializeGame(cam, groups) {
  const groupIds = {};
  for (const k in groups || {}) groupIds[k] = groups[k].filter(e => !e.dead).map(e => e.id);
  return JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    seed: G.map.seed,
    mapW: MAP_W,
    fjords: G.map.fjords,
    tiles: Array.from(G.map.tiles),
    wood: Array.from(G.map.wood),
    explored: Array.from(G.explored),
    ents: G.ents.filter(e => !e.dead),
    nextId: G.nextId,
    players: G.players,
    human: G.human,
    time: G.time,
    speed: G.speed,
    projectiles: G.projectiles,
    areas: G.areas,
    effects: G.effects.filter(f => f.type === 'corpse' || f.type === 'rubble'),
    ais: G.ais.map(aiState),
    tut: G.tut || null,
    mission: G.mission || null,
    cam: cam ? { x: cam.x, y: cam.y } : null,
    groups: groupIds,
  });
}

function restoreGame(json) {
  const d = JSON.parse(json);
  if (!d || d.v !== 1) throw new Error('Unknown save format');
  setMapSize(d.mapW || MAP_SIZES.medium);
  G.map = new GameMap(d.seed, d.players.length, !!d.fjords);
  G.map.tiles.set(d.tiles);
  G.map.wood.set(d.wood);
  G.map.bldg.fill(0);
  G.map.dirty.length = 0;
  G.ents = d.ents;
  G.byId = new Map();
  for (const e of G.ents) {
    G.byId.set(e.id, e);
    if (e.kind === 'bldg') {
      for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) G.map.bldg[G.map.idx(x, y)] = e.id;
    }
  }
  G.nextId = d.nextId;
  G.players = d.players;
  G.human = d.human;
  G.time = d.time;
  G.speed = d.speed || 1;
  G.projectiles = d.projectiles || [];
  G.areas = d.areas || [];
  G.effects = d.effects || [];
  G.msgs = [];
  // Older saves stored the two computer players separately.
  G.ais = (d.ais || [d.ai, d.ai2]).filter(Boolean).map(restoreAI);
  G.tut = d.tut || null;
  G.mission = d.mission || null;
  G.vis = new Uint8Array(MAP_W * MAP_H);
  G.explored = Uint8Array.from(d.explored);
  G.over = null;
  G.paused = false;
  G.revealAll = false;
  G.attackMsgT = 0;
  G.visT = 0;
  G.checkT = 1;
  updateFood();
  updateVisibility();
  const groups = {};
  for (const k in d.groups || {}) groups[k] = d.groups[k].map(id => G.byId.get(id)).filter(Boolean);
  return { cam: d.cam, groups };
}

function saveGame(slot, cam, groups) {
  if (!G.map || G.over) return false;
  return storageSet(SAVE_KEYS[slot], serializeGame(cam, groups));
}

// Short description of a save for menus, or null if there is none.
function saveInfo(slot) {
  const raw = storageGet(SAVE_KEYS[slot]);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    const p = d.players[d.human];
    const t = Math.floor(d.time);
    return {
      slot, savedAt: d.savedAt,
      text: `${FACTIONS[p.faction].short} · ${Math.floor(t / 60)}m ${t % 60}s in · saved ${new Date(d.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    };
  } catch (e) { return null; }
}

function loadSave(slot) {
  const raw = storageGet(SAVE_KEYS[slot]);
  if (!raw) return null;
  return restoreGame(raw);
}

function clearAutosave() { storageDel(SAVE_KEYS.auto); }
