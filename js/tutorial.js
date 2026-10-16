'use strict';
// Guided first mission: teaches the basics one objective at a time and ends
// with a small raid to fight off. State lives in G.tut so saves keep it.

const TUT_SEED = 424242;

function tutNames() {
  const f = humanPlayer().faction;
  return {
    W: unitName('worker', f), M: unitName('melee', f), R: unitName('ranged', f),
    hall: bldgName('hall', f), farm: bldgName('farm', f), barracks: bldgName('barracks', f),
    mill: bldgName('mill', f), tower: bldgName('tower', f),
  };
}

function tutOwn(type) { return G.ents.filter(e => !e.dead && e.owner === G.human && e.type === type); }
function tutBuilt(type) { return tutOwn(type).some(b => b.built); }
function tutOrders(kind) { return tutOwn('worker').filter(u => u.order && u.order.type === kind).length; }
function tutHomeMine() {
  const hall = tutOwn('hall')[0];
  return hall ? nearestMine(hall.x, hall.y) : null;
}

const TUTORIAL_STEPS = [
  {
    title: 'Choose a worker',
    text: n => UI.touch ? `Tap one of your ${n.W}s to select it.` : `Click one of your ${n.W}s to select it. You can also drag a box around several.`,
    done: () => [...UI.selected].some(e => e.owner === G.human && e.type === 'worker'),
  },
  {
    title: 'Mine gold',
    text: n => UI.touch
      ? `With ${n.W}s selected, tap the gold mine. Send at least two of them.`
      : `With ${n.W}s selected, right-click the gold mine. Send at least two of them.`,
    done: () => tutOrders('gold') >= 2,
    focus: tutHomeMine,
  },
  {
    title: 'Cut lumber',
    text: n => UI.touch
      ? `Select another ${n.W} and tap a forest to chop lumber.`
      : `Select another ${n.W} and right-click a forest to chop lumber.`,
    done: () => tutOrders('wood') >= 1,
  },
  {
    title: 'Train a worker',
    text: n => `Select your ${n.hall} and press the ${n.W} button (T). More workers means more gold.`,
    done: () => tutOwn('worker').length >= 5,
    keys: ['T'],
  },
  {
    title: 'Build a farm',
    text: n => `Every unit eats. Select a ${n.W}, press Build (B), then ${n.farm} (F), and place it on open ground. Wait for it to finish.`,
    done: () => tutBuilt('farm'),
    keys: ['B', 'F'],
  },
  {
    title: 'Raise a barracks',
    text: n => `Build a ${n.barracks} (B, then M). It trains your warriors.`,
    done: () => tutBuilt('barracks'),
    keys: ['B', 'M'],
  },
  {
    title: 'Train warriors',
    text: n => `Select the ${n.barracks} and train three ${n.M}s (H).`,
    done: () => tutOwn('melee').length >= 3,
    keys: ['H'],
  },
  {
    title: 'Build a lumber workshop',
    text: n => `Build a ${n.mill} (B, then W). It unlocks towers and ${n.R}s, and takes lumber drop-offs.`,
    done: () => tutBuilt('mill'),
    keys: ['B', 'W'],
  },
  {
    title: 'Raise a tower',
    text: n => `Build a ${n.tower} (B, then R) close to your ${n.hall}. Towers shoot enemies on sight.`,
    done: () => tutBuilt('tower'),
    keys: ['B', 'R'],
  },
  {
    title: 'Raiders!',
    text: n => UI.touch
      ? `Raiders are coming for your ${n.hall}. Hold and drag to select your ${n.M}s, then tap an enemy to attack. Use the Idle button to put lazy workers back to work.`
      : `Raiders are coming for your ${n.hall}. Drag a box around your ${n.M}s and right-click an enemy, or press A and click to attack-move.`,
    start: tutSpawnRaid,
    done: () => G.tut.raid && G.tut.raid.every(id => !alive(G.byId.get(id))),
  },
];

function startTutorial() {
  newGame({ faction: Setup.faction, difficulty: 'beginner', speed: 1, seed: TUT_SEED });
  // No enemy base: the tutorial brings its own raiders at the end.
  for (const e of G.ents) {
    if (e.owner !== 1) continue;
    e.dead = true;
    G.byId.delete(e.id);
    if (e.kind === 'bldg') for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) G.map.bldg[G.map.idx(x, y)] = 0;
  }
  G.ents = G.ents.filter(e => !e.dead);
  G.ai = null;
  G.ai2 = null;
  const p = humanPlayer();
  p.gold = 800;
  p.wood = 600;
  updateFood();
  G.tut = { step: 0, raid: null, pulseT: 0 };
  enterGame();
  frameHome();
  tutEnterStep(0);
}

function tutEnterStep(i) {
  G.tut.step = i;
  const s = TUTORIAL_STEPS[i];
  if (s && s.start) s.start();
  $('objective').classList.remove('min');
  UI.sig = '';
  tutRender();
}

function tutRender() {
  if (G.mission) return missionRender();
  const box = $('objective');
  $('obj-skip').hidden = false;
  if (!G.tut || G.over) { box.hidden = true; return; }
  const s = TUTORIAL_STEPS[G.tut.step];
  if (!s) { box.hidden = true; return; }
  box.hidden = false;
  $('obj-step').textContent = `Tutorial · ${G.tut.step + 1} of ${TUTORIAL_STEPS.length}`;
  $('obj-title').textContent = s.title;
  $('obj-text').textContent = s.text(tutNames());
}

// Called every frame from the game loop.
function tutorialUpdate(dt) {
  if (!G.tut || G.over || G.paused) return;
  const s = TUTORIAL_STEPS[G.tut.step];
  if (!s) return;
  if (s.focus) {
    G.tut.pulseT -= dt;
    const f = s.focus();
    if (f && G.tut.pulseT <= 0) {
      G.tut.pulseT = 1.1;
      G.effects.push({ type: 'marker', x: f.x, y: f.y + f.h * TILE / 2 - 8, t: 0.6, color: '#f1cf4a' });
    }
  }
  if (!s.done()) return;
  sfx('done');
  msg(`Done: ${s.title}.`);
  if (G.tut.step + 1 < TUTORIAL_STEPS.length) tutEnterStep(G.tut.step + 1);
  else {
    G.over = 'victory';
    G.tut.complete = true;
    sfx('victory');
    tutRender();
  }
}

// Highlight the command buttons the current step asks for.
function tutorialHint(key) {
  if (!G.tut || G.over) return false;
  const s = TUTORIAL_STEPS[G.tut.step];
  return !!(s && s.keys && s.keys.includes(key));
}

function tutSkip() {
  if (!G.tut || G.over) return;
  const i = G.tut.step;
  if (i + 1 < TUTORIAL_STEPS.length) {
    // Skipping a building step should not strand the player without it.
    const p = humanPlayer();
    p.gold += 150;
    p.wood += 100;
    tutEnterStep(i + 1);
  }
}

function tutSpawnRaid() {
  const hall = tutOwn('hall')[0];
  if (!hall) return;
  const enemy = G.players[1];
  // Raiders appear well outside the base, on the way toward the map centre.
  const cx = Math.floor(MAP_W / 2) - 6, cy = Math.floor(MAP_H / 2) - 6;
  const sp = nearestWalkable(G.map, cx, cy, 10) || nearestWalkable(G.map, hall.tx + 14, hall.ty + 14, 12);
  const ids = [];
  const types = ['melee', 'melee', 'ranged'];
  const taken = new Set();
  for (const t of types) {
    const s = nearestWalkable(G.map, sp.x, sp.y, 6, (x, y) => taken.has(x + y * MAP_W));
    if (!s) continue;
    taken.add(s.x + s.y * MAP_W);
    const u = spawnUnit(t, enemy.id, s.x, s.y);
    ids.push(u.id);
  }
  const raid = ids.map(id => G.byId.get(id));
  cmdMove(raid, hall.tx + 1, hall.ty + hall.h, true);
  G.tut.raid = ids;
  G.lastAttack = { x: raid[0].x, y: raid[0].y };
  msg(`${FACTIONS[enemy.faction].short} raiders spotted!` + (UI.touch ? ' Watch the minimap for red dots.' : ' Press Space to look.'));
  G.attackMsgT = 15;
  sfx('alarm');
}
