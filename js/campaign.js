'use strict';
// The Vikings' campaign: five chapters, each a small scenario with its own
// goal. Mission state lives in G.mission so saves keep it.

const CAMPAIGN_KEY = 'norsecraft.campaign.v1';

function campaignProgress() {
  const n = parseInt(storageGet(CAMPAIGN_KEY), 10);
  return isNaN(n) ? 0 : n;
}
function setCampaignProgress(n) {
  if (n > campaignProgress()) storageSet(CAMPAIGN_KEY, String(n));
}

// ---------- helpers ----------

function mOwn(owner, type) { return G.ents.filter(e => !e.dead && e.owner === owner && (!type || e.type === type)); }
function mFoeUnits() { return G.ents.filter(e => !e.dead && e.owner === 1 && e.kind === 'unit'); }
function mFoeBuildings() { return G.ents.filter(e => !e.dead && e.owner === 1 && e.kind === 'bldg'); }
function mHall(owner) { return G.ents.find(e => !e.dead && e.owner === owner && e.type === 'hall'); }
function mClock(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

function mRemoveSide(owner) {
  for (const e of G.ents) {
    if (e.owner !== owner) continue;
    e.dead = true;
    G.byId.delete(e.id);
    if (e.kind === 'bldg') for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) G.map.bldg[G.map.idx(x, y)] = 0;
  }
  G.ents = G.ents.filter(e => !e.dead);
}

// Place a finished building for a side, searching outward from a tile.
function mPlace(type, owner, cx, cy, minR = 2) {
  const d = BUILDINGS[type];
  const reveal = G.revealAll;
  G.revealAll = true;
  try {
    for (let r = minR; r < 18; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (!canPlace(type, x, y, owner, null)) continue;
          // Leave a walkable ring so nothing gets boxed in.
          let ok = true;
          for (let yy = y - 1; yy <= y + d.h && ok; yy++) {
            for (let xx = x - 1; xx <= x + d.w; xx++) {
              if (!G.map.isWalkable(xx, yy)) { ok = false; break; }
            }
          }
          if (!ok) continue;
          if (G.ents.some(m => !m.dead && m.type === 'mine' && rectDist(x, y, { x: m.tx - 2 - d.w + 1, y: m.ty - 2 - d.h + 1, w: m.w + 4 + d.w - 1, h: m.h + 4 + d.h - 1 }) === 0)) continue;
          return spawnBuilding(type, owner, x, y, true);
        }
      }
    }
  } finally {
    G.revealAll = reveal;
  }
  return null;
}

function mSpawn(owner, types, cx, cy) {
  const taken = new Set();
  const out = [];
  for (const t of types) {
    const s = nearestWalkable(G.map, cx, cy, 10, (x, y) => taken.has(x + y * MAP_W) ||
      G.ents.some(e => !e.dead && e.kind === 'unit' && tileOf(e).x === x && tileOf(e).y === y));
    if (!s) continue;
    taken.add(s.x + s.y * MAP_W);
    out.push(spawnUnit(t, owner, s.x, s.y));
  }
  return out;
}

function mHome(owner) {
  const s = G.map.starts[owner];
  return { x: s.x + 1, y: s.y + 1 };
}

// Units for each side that start next to their hall.
function mArmy(owner, types) {
  const h = mHome(owner);
  const dir = owner === 0 ? 1 : -1;
  return mSpawn(owner, types, h.x + dir * 3, h.y + dir * 4);
}

function mBase(owner, types) {
  const h = mHome(owner);
  const dir = owner === 0 ? 1 : -1;
  for (const t of types) mPlace(t, owner, h.x + dir * 2, h.y - dir * 1, 3);
}

function mWave(types) {
  const e = mHome(1);
  const hall = mHall(0);
  const raid = mSpawn(1, types, e.x - 4, e.y - 4);
  if (hall && raid.length) cmdMove(raid, hall.tx + 1, hall.ty + hall.h, true);
  return raid;
}

function mTuneAI(over) {
  if (!G.ai) return;
  G.ai.diff = { ...G.ai.diff, ...over };
  if (over.wave) G.ai.wave = over.wave;
}

// ---------- chapters ----------

const MISSIONS = [
  {
    key: 'shore',
    name: 'The Burning Shore',
    seed: 1111,
    blurb: 'Hold your village against three waves of raiders.',
    story: [
      'Ice-blue sails were sighted off the coast at dawn. The Jötnar have come down from the north, and they are hungry for Midgard.',
      'Your village is small, but its warriors are brave. Raise towers, train Huscarls and hold the line until the raiders break.',
    ],
    goals: ['Survive three waves of Jötnar raiders.', 'Keep your Longhouse standing.'],
    win: 'The last raider lies in the surf. Word of your stand will spread from fjord to fjord.',
    setup(m) {
      mRemoveSide(1);
      G.ai = null;
      mBase(0, ['barracks', 'farm', 'farm']);
      mArmy(0, ['worker', 'worker', 'melee', 'melee', 'melee', 'ranged', 'ranged']);
      const p = humanPlayer();
      p.gold = 500; p.wood = 350;
      m.waves = 0;
    },
    WAVES: [
      { t: 100, units: ['melee', 'melee', 'melee'] },
      { t: 220, units: ['melee', 'melee', 'melee', 'ranged', 'ranged'] },
      { t: 340, units: ['melee', 'melee', 'melee', 'melee', 'ranged', 'ranged', 'rider', 'rider'] },
    ],
    update(m) {
      const w = this.WAVES[m.waves];
      if (w && G.time >= w.t) {
        mWave(w.units);
        m.waves++;
        msg(m.waves === this.WAVES.length ? 'The last and largest wave is coming!' : `Wave ${m.waves} is coming!`);
        G.attackMsgT = 12;
        sfx('alarm');
      }
    },
    objective(m) {
      const left = mFoeUnits().length;
      const w = this.WAVES[m.waves];
      if (left) return { title: 'Raiders attack!', text: `Defend your Longhouse. ${left} raider${left === 1 ? '' : 's'} left. Wave ${m.waves} of ${this.WAVES.length}.` };
      if (w) return { title: 'Hold the village', text: `Wave ${m.waves + 1} of ${this.WAVES.length} lands in ${mClock(w.t - G.time)}. Build a Watchtower and train warriors.` };
      return { title: 'Hold the village', text: 'Finish them off.' };
    },
    won(m) { return m.waves >= this.WAVES.length && !mFoeUnits().length; },
    lost() { return !mHall(0); },
  },
  {
    key: 'gold',
    name: 'Gold of the Giants',
    seed: 2222,
    blurb: 'Take the fight to the Jötnar and burn their Frost Hall.',
    story: [
      'The raiders came from a camp across the fjord, built around a mine of giant-gold.',
      'Their warband is spent, but the camp is guarded by Ice Spires. Take your army and your Ballista, break the towers, and bring down the Frost Hall.',
    ],
    goals: ['Destroy the Jötnar Frost Hall.'],
    win: 'The Frost Hall collapses into slush. The gold of the giants now fills your coffers.',
    setup() {
      mBase(0, ['barracks', 'mill', 'farm', 'farm', 'farm']);
      mArmy(0, ['worker', 'worker', 'melee', 'melee', 'melee', 'melee', 'melee', 'ranged', 'ranged', 'ranged', 'siege']);
      mBase(1, ['barracks', 'farm', 'tower', 'tower']);
      mArmy(1, ['melee', 'melee', 'melee', 'ranged', 'ranged']);
      const p = humanPlayer();
      p.gold = 600; p.wood = 400;
      mTuneAI({ firstAttack: 1e9 });
    },
    objective() {
      const n = mOwn(1, 'hall').length;
      return { title: 'Burn the Frost Hall', text: `Bring down the Frost Hall${n > 1 ? 's' : ''} across the fjord. Use your Ballista on the Ice Spires.` };
    },
    won() { return !mOwn(1, 'hall').length; },
    lost() { return !mOwn(0).some(e => e.kind === 'unit' && e.type !== 'worker') && !mOwn(0, 'barracks').length; },
  },
  {
    key: 'winter',
    name: 'The Long Winter',
    seed: 3333,
    blurb: 'Fimbulwinter falls. Survive ten minutes of endless assault.',
    story: [
      'The sun has gone pale and the snow will not stop. The völur call it Fimbulwinter, the winter before the end.',
      'The Jötnar grow bolder in the cold. They will throw everything at your hall. Survive until the thaw.',
    ],
    goals: ['Survive for 10 minutes.', 'Keep your Longhouse standing.'],
    win: 'The clouds part and the first warm wind blows from the south. You have outlasted the winter.',
    setup() {
      mBase(0, ['barracks', 'farm', 'farm', 'tower']);
      mArmy(0, ['worker', 'worker', 'worker', 'worker', 'melee', 'melee', 'melee', 'melee', 'ranged', 'ranged']);
      const p = humanPlayer();
      p.gold = 600; p.wood = 450;
      G.players[1].gold += 600;
      mTuneAI({ firstAttack: 100, wave: 3, waveGrow: 2, gather: 1.3, think: 0.8, workers: 10 });
    },
    LENGTH: 600,
    objective() {
      return { title: 'Survive the winter', text: `Hold out until the thaw: ${mClock(this.LENGTH - G.time)} left.` };
    },
    won() { return G.time >= this.LENGTH; },
    lost() { return !mHall(0); },
  },
  {
    key: 'grove',
    name: 'The Völva of the Ironwood',
    seed: 4444,
    blurb: 'Find the seeress in the woods, then destroy the giants’ outpost.',
    story: [
      'A seeress lives in a grove at the edge of the Ironwood. She has seen how this war ends, and she will only speak to a jarl who comes to her.',
      'Find her grove. With her magic on your side, you can destroy the Jötnar outpost that guards the road north.',
    ],
    goals: ['Bring any unit to the Völva’s grove (purple on the minimap).', 'Destroy every Jötnar building.'],
    win: 'The outpost is ash. The Völva smiles: "The road north is open, jarl. Ragnarök waits at its end."',
    setup(m) {
      mBase(0, ['barracks', 'farm', 'farm']);
      mArmy(0, ['worker', 'worker', 'melee', 'melee', 'melee', 'melee', 'ranged', 'ranged', 'rider']);
      mBase(1, ['barracks', 'farm', 'tower']);
      const p = humanPlayer();
      p.gold = 500; p.wood = 300;
      const mine = G.map.mines[2];
      const g = nearestWalkable(G.map, mine.x + 5, mine.y + 1, 8) || nearestWalkable(G.map, mine.x, mine.y - 2, 12);
      m.grove = { x: g.x, y: g.y };
      m.stage = 0;
      mTuneAI({ firstAttack: 360 });
    },
    update(m) {
      if (m.stage !== 0) return;
      const g = m.grove;
      const found = mOwn(0).some(e => e.kind === 'unit' && !e.hidden && rectDist(tileOf(e).x, tileOf(e).y, { x: g.x, y: g.y, w: 1, h: 1 }) <= 3);
      if (!found) return;
      m.stage = 1;
      mPlace('temple', 0, g.x, g.y, 1);
      const cs = mSpawn(0, ['caster', 'caster'], g.x, g.y);
      for (const c of cs) { c.mana = 100; G.effects.push({ type: 'summon', x: c.x, y: c.y, t: 0.9, faction: 'vikings' }); }
      humanPlayer().up.summon = 1;
      msg('The Völva joins you, and teaches your seeresses to call the Einherjar!');
      sfx('summon');
      mTuneAI({ firstAttack: G.time + 150 });
    },
    marker(m) { return m.stage === 0 ? m.grove : null; },
    objective(m) {
      if (m.stage === 0) return { title: 'Find the Völva', text: 'Lead any unit to the seeress’s grove, marked in purple on the minimap.' };
      const n = mFoeBuildings().length;
      return { title: 'Destroy the outpost', text: `Burn every Jötnar building. ${n} left. Your seeresses heal (E) and summon the Einherjar (U).` };
    },
    won(m) { return m.stage === 1 && !mFoeBuildings().length; },
    lost() { return !mOwn(0).length; },
  },
  {
    key: 'ragnarok',
    name: 'Ragnarök',
    seed: 5555,
    blurb: 'The final battle. Only one people will see the new world.',
    story: [
      'The wolf has slipped its chains and the horn of Heimdall sounds across the nine worlds. This is Ragnarök.',
      'The Jötnar come with all their strength and all their magic. Build, raise every warrior you can, and destroy them utterly, or be destroyed.',
    ],
    goals: ['Destroy every Jötnar unit and building.'],
    win: 'The giants are gone. From the ashes of the old world a green new land rises, and your name is the first the skalds sing.',
    setup() {
      mBase(0, ['barracks', 'farm', 'farm']);
      mArmy(0, ['worker', 'worker', 'melee', 'melee', 'melee', 'melee', 'ranged', 'ranged']);
      mBase(1, ['barracks', 'farm']);
      mArmy(1, ['worker', 'worker', 'melee', 'melee', 'ranged']);
      const p = humanPlayer();
      p.gold = 1000; p.wood = 700;
      // Easy-strength economy, but it keeps growing its waves for a long fight.
      mTuneAI({ gather: 0.75, firstAttack: 420, wave: 4, waveGrow: 1, workers: 8 });
    },
    objective() {
      const b = mFoeBuildings().length, u = mFoeUnits().length;
      return { title: 'Ragnarök', text: `Destroy the Jötnar. ${b} building${b === 1 ? '' : 's'} and ${u} unit${u === 1 ? '' : 's'} remain.` };
    },
    won() { return !mOwn(1).length; },
    lost() { return !mOwn(0).length; },
  },
];

// ---------- running a mission ----------

function startMission(i) {
  const def = MISSIONS[i];
  Setup.faction = 'vikings';
  newGame({ faction: 'vikings', difficulty: i >= 2 ? 'normal' : 'easy', speed: Setup.speed, seed: def.seed });
  G.mission = { id: i, renderT: 0, pulseT: 0 };
  def.setup(G.mission);
  updateFood();
  updateVisibility();
  enterGame();
  frameHome();
  msg(`Chapter ${i + 1}: ${def.name}`);
}

function missionUpdate(dt) {
  const m = G.mission;
  if (!m || G.over || G.paused) return;
  const def = MISSIONS[m.id];
  if (def.update) def.update(m, dt);
  const mk = def.marker && def.marker(m);
  if (mk) {
    m.pulseT -= dt;
    if (m.pulseT <= 0) {
      m.pulseT = 1.1;
      G.effects.push({ type: 'marker', x: mk.x * TILE + 16, y: mk.y * TILE + 8, t: 0.6, color: '#c58cff' });
    }
  }
  if (def.lost(m)) { G.over = 'defeat'; sfx('defeat'); }
  else if (def.won(m)) {
    G.over = 'victory';
    setCampaignProgress(m.id + 1);
    sfx('victory');
  }
  m.renderT -= dt;
  if (m.renderT <= 0 || G.over) { m.renderT = 0.25; missionRender(); }
}

function missionRender() {
  const box = $('objective');
  const m = G.mission;
  if (!m || G.over) { box.hidden = true; return; }
  const def = MISSIONS[m.id];
  const o = def.objective(m);
  box.hidden = false;
  $('obj-skip').hidden = true;
  $('obj-step').textContent = `Chapter ${m.id + 1} · ${def.name}`;
  $('obj-title').textContent = o.title;
  $('obj-text').textContent = o.text;
}

function missionMarker() {
  const m = G.mission;
  if (!m || G.over) return null;
  const def = MISSIONS[m.id];
  return def.marker ? def.marker(m) : null;
}

// ---------- campaign screens ----------

const RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ'];

function showCampaign() {
  const done = campaignProgress();
  const list = $('chapters');
  list.innerHTML = '';
  MISSIONS.forEach((def, i) => {
    const b = document.createElement('button');
    b.className = 'chapter';
    const locked = i > done;
    if (locked) b.classList.add('locked');
    if (i < done) b.classList.add('done');
    b.disabled = locked;
    b.innerHTML = `<span class="rune">${RUNES[i]}</span><span class="ch-body"><span class="ch-num">Chapter ${i + 1}${i < done ? ' · Won' : locked ? ' · Locked' : ''}</span>` +
      `<span class="ch-name">${def.name}</span><span class="ch-blurb">${locked ? 'Win the chapter before to unlock.' : def.blurb}</span></span>`;
    if (!locked) b.addEventListener('click', () => showBriefing(i));
    list.appendChild(b);
  });
  $('campaign').style.display = 'flex';
}

function showBriefing(i) {
  const def = MISSIONS[i];
  $('campaign').style.display = 'none';
  $('end').style.display = 'none';
  $('brief-ch').textContent = `Chapter ${i + 1} of ${MISSIONS.length}`;
  $('brief-title').textContent = def.name;
  $('brief-story').innerHTML = def.story.map(p => `<p>${p}</p>`).join('');
  $('brief-goals').innerHTML = def.goals.map(g => `<li>${g}</li>`).join('');
  $('brief-go').onclick = () => { $('briefing').style.display = 'none'; audioCtx(); startMission(i); };
  $('briefing').style.display = 'flex';
  // The briefing sits over the title screen, which keeps the game loop idle.
  $('title').style.display = 'flex';
}
