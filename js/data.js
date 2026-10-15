'use strict';
// Static game data: map constants, factions, units, buildings, upgrades.

const TILE = 32;
const MAP_W = 64;
const MAP_H = 64;

const T = { GRASS: 0, SNOW: 1, FOREST: 2, WATER: 3, ROCK: 4, STUMP: 5 };
const WOOD_PER_TREE = 100;
const CARRY = 10;
const WOOD_CARRY = 20;
const MINE_GOLD = 10000;
const MINE_TIME = 2.2;
const CHOP_TIME = 3.2;
const MAX_FOOD = 60;

const FACTIONS = {
  vikings: {
    name: 'Vikings of Midgard',
    short: 'Vikings',
    color: '#b8322a',
    dark: '#6e1a14',
    skin: '#e8b98f',
    hair: '#c9822e',
    blurb: 'Raiders of the fjords, sworn to Odin. Shield walls, longbows and Valkyrie riders.',
  },
  jotnar: {
    name: 'Jötnar of Jötunheim',
    short: 'Jötnar',
    color: '#2a86b8',
    dark: '#134a66',
    skin: '#a9cddc',
    hair: '#eef6fa',
    blurb: 'Frost giants and their brood, come down from the ice to bring Fimbulwinter.',
  },
};

const UNITS = {
  worker: {
    hp: 30, atk: 3, armor: 0, range: 1, cd: 1.2, speed: 1.6, sight: 4,
    gold: 50, wood: 0, time: 10, hotkey: 'T',
    names: { vikings: 'Thrall', jotnar: 'Drudge' },
    desc: 'Gathers gold and lumber, builds structures.',
  },
  melee: {
    hp: 60, atk: 8, armor: 2, range: 1, cd: 1.0, speed: 1.7, sight: 4,
    gold: 70, wood: 10, time: 14, hotkey: 'H',
    names: { vikings: 'Huscarl', jotnar: 'Frost Troll' },
    desc: 'Sturdy front-line fighter.',
  },
  ranged: {
    hp: 40, atk: 6, armor: 0, range: 5, cd: 1.3, speed: 1.7, sight: 6,
    gold: 60, wood: 30, time: 14, hotkey: 'B', req: ['mill'], projectile: 'arrow',
    names: { vikings: 'Bowman', jotnar: 'Ice Hurler' },
    desc: 'Attacks from range. Requires a lumber workshop.',
  },
  rider: {
    hp: 90, atk: 11, armor: 3, range: 1, cd: 1.0, speed: 2.7, sight: 5,
    gold: 120, wood: 30, time: 20, hotkey: 'V', req: ['stable'],
    names: { vikings: 'Valkyrie', jotnar: 'Wolf Rider' },
    desc: 'Fast, heavily armed rider. Requires a stable.',
  },
  siege: {
    hp: 90, atk: 34, armor: 0, range: 7, minRange: 2, cd: 3.2, speed: 0.9, sight: 8,
    gold: 150, wood: 150, time: 28, hotkey: 'G', req: ['forge'], projectile: 'rock',
    splash: 1.1, bldgBonus: 1.6,
    names: { vikings: 'Ballista', jotnar: 'Stone Giant' },
    desc: 'Long-range siege that hurts everything near the impact. Requires a forge.',
  },
};

const BUILDINGS = {
  hall: {
    w: 3, h: 3, hp: 1200, armor: 2, gold: 400, wood: 250, time: 45, food: 5, sight: 8,
    hotkey: 'L', trains: ['worker'], dropoff: ['gold', 'wood'],
    names: { vikings: 'Longhouse', jotnar: 'Frost Hall' },
    desc: 'Trains workers. Gold and lumber are returned here.',
  },
  farm: {
    w: 2, h: 2, hp: 400, armor: 1, gold: 80, wood: 40, time: 18, food: 5, sight: 3,
    hotkey: 'F',
    names: { vikings: 'Homestead', jotnar: 'Rime Pen' },
    desc: 'Provides food for 5 more units.',
  },
  barracks: {
    w: 3, h: 3, hp: 800, armor: 2, gold: 150, wood: 100, time: 28, sight: 4,
    hotkey: 'M', trains: ['melee', 'ranged', 'rider', 'siege'],
    names: { vikings: 'Mead Hall', jotnar: "Giant's Lodge" },
    desc: 'Trains warriors.',
  },
  mill: {
    w: 2, h: 2, hp: 600, armor: 1, gold: 100, wood: 60, time: 22, sight: 4,
    hotkey: 'W', dropoff: ['wood'], research: ['arrows'],
    names: { vikings: 'Woodwright', jotnar: 'Ice Carver' },
    desc: 'Lumber drop-off. Allows ranged units and towers.',
  },
  stable: {
    w: 2, h: 2, hp: 600, armor: 1, gold: 120, wood: 100, time: 24, sight: 4,
    hotkey: 'S', req: ['barracks'],
    names: { vikings: 'Stable', jotnar: 'Wolf Den' },
    desc: 'Allows riders to be trained.',
  },
  forge: {
    w: 2, h: 2, hp: 700, armor: 2, gold: 140, wood: 120, time: 28, sight: 4,
    hotkey: 'O', req: ['barracks'], research: ['weapons', 'armor'],
    names: { vikings: 'Smithy', jotnar: 'Frost Forge' },
    desc: 'Researches weapon and armor upgrades. Allows siege.',
  },
  tower: {
    w: 2, h: 2, hp: 450, armor: 3, gold: 80, wood: 100, time: 24, sight: 7,
    hotkey: 'R', req: ['mill'], atk: 9, range: 6, cd: 1.5, projectile: 'arrow',
    names: { vikings: 'Watchtower', jotnar: 'Ice Spire' },
    desc: 'Defensive tower that shoots nearby enemies.',
  },
  mine: {
    w: 3, h: 3, hp: 99999, armor: 99, sight: 0, neutral: true,
    names: { vikings: 'Gold Mine', jotnar: 'Gold Mine', neutral: 'Gold Mine' },
  },
};

const BUILD_ORDER = ['hall', 'farm', 'barracks', 'mill', 'stable', 'forge', 'tower'];

const RESEARCH = {
  weapons: { gold: 200, wood: 100, time: 30, hotkey: 'E', name: 'Runed Blades', desc: '+2 attack for melee fighters and riders.' },
  armor: { gold: 200, wood: 150, time: 30, hotkey: 'A', name: 'Iron Mail', desc: '+1 armor for all units.' },
  arrows: { gold: 150, wood: 150, time: 26, hotkey: 'U', name: 'Barbed Arrows', desc: '+2 attack for ranged units and towers.' },
};

const DIFFICULTY = {
  easy: { gather: 0.75, firstAttack: 540, wave: 3, waveGrow: 1, workers: 7, think: 1.6 },
  normal: { gather: 1.0, firstAttack: 360, wave: 5, waveGrow: 2, workers: 9, think: 1.0 },
  hard: { gather: 1.3, firstAttack: 210, wave: 6, waveGrow: 2, workers: 12, think: 0.7 },
};

function unitName(type, faction) { return UNITS[type].names[faction]; }
function bldgName(type, faction) { return BUILDINGS[type].names[faction] || BUILDINGS[type].names.vikings; }
