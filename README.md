# Norsecraft

A real-time strategy game for the browser, inspired by the classic 1994 orcs-vs-humans RTS and set in Norse myth.
The **Vikings of Midgard** fight the **Jötnar of Jötunheim** over a snowy fjordland.

No build step and no dependencies. Plain HTML, CSS and JavaScript on a `<canvas>`. All art and sound are generated in code, so the repo has no image or audio files.

## Play

Open `index.html` through any static web server:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

To host it for free, use GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**.

## The game

New to RTS games? Press **Tutorial** on the title screen. Ten short steps walk you through mining, building and training, and end with a raid to fight off.

**Campaign:** *The Saga of the North* is five chapters for the Vikings, each unlocked by winning the one before:

| | Chapter | Goal |
|---|---|---|
| 1 | The Burning Shore | Survive three waves of raiders |
| 2 | Gold of the Giants | Burn the Jötnar Frost Hall |
| 3 | The Long Winter | Hold out for 10 minutes |
| 4 | The Völva of the Ironwood | Find the seeress, then destroy the outpost |
| 5 | Ragnarök | Destroy the Jötnar for good |


- **Economy:** mine gold and chop lumber with workers. Build farms for food (each unit costs 1).
- **Repair:** workers fix damaged buildings (right-click it, or `E`). A full repair costs about a third of the building's price.
- **Two mirrored factions**, each with its own units and buildings:

| Role | Vikings | Jötnar | Needs |
|---|---|---|---|
| Worker | Thrall | Drudge | — |
| Melee | Huscarl | Frost Troll | — |
| Ranged | Bowman | Ice Hurler | Lumber workshop |
| Rider | Valkyrie | Wolf Rider | Stable |
| Siege | Ballista | Stone Giant | Forge |
| Spellcaster | Völva | Frost Shaman | Temple |

| Building | Vikings | Jötnar |
|---|---|---|
| Town hall | Longhouse | Frost Hall |
| Farm | Homestead | Rime Pen |
| Barracks | Mead Hall | Giant's Lodge |
| Lumber workshop | Woodwright | Ice Carver |
| Stable | Stable | Wolf Den |
| Forge | Smithy | Frost Forge |
| Tower | Watchtower | Ice Spire |
| Temple | Hof | Rime Shrine |

- **Heroes:** call one hero at the Longhouse once you have a barracks. Heroes gain experience when enemies fall near them (up to level 5) and keep their level if called again after falling.

| | Vikings: Sigrún Shield-Maiden | Jötnar: Hrungnir Stone-Heart |
|---|---|---|
| Aura | Shield Wall: allies nearby +1 armor | Giant's Wrath: allies nearby +1 attack |
| Ability (`R`, level 2+) | War Cry: allies nearby hit 30% faster and +2 damage for 10s | Earthshaker: 30 damage and a 1.5s stun around him |

- **Ships and fjords:** pick **Fjords** terrain for a map split by a sea, crossed by shallow fords. Build a shipyard on the shore (it needs a lumber workshop):

| | Vikings | Jötnar | |
|---|---|---|---|
| Shipyard | Naust | Ice Harbor | Builds ships; also takes lumber |
| Transport | Knarr | Ice Raft | Carries 6 land units, unarmed |
| Warship | Drakkar | Naglfar | Bombards ships and the shore from range |

  Right-click your transport with troops selected to board it. With the transport selected, right-click a shore to sail there and land them (`U` unloads where it is).
- **Upgrades:** Runed Blades, Iron Mail and Barbed Arrows.
- **Magic:** spellcasters use mana, which refills over time. Every caster knows a heal, which it also casts by itself on wounded allies nearby. Two more spells are learned at the temple:

| Spell | Vikings | Jötnar | Mana |
|---|---|---|---|
| Heal (`E`) | Eir's Mending | Rime Mending | 20 |
| Summon (`U`) | Call the Einherjar: 2 ghostly warriors | Frost Wolves: 2 wolves | 50 |
| Storm (`T`) | Thor's Storm: short, heavy lightning | Fimbulwinter: a longer blizzard | 70 |

  Summoned units fade after 45 seconds and cost no food.
- **Save and load** from the pause menu. The game also autosaves every minute and when you leave the page, so **Continue** on the title screen picks up where you left off. Saves stay in your browser.
- **Music and voices:** a generated Norse score (drone, frame drum and lyre) that picks up drums during battle, plus short voice replies from your units. Both are made in code; toggle music with ♫.
- **Skirmish options:** small (48×48), medium (64×64) or large (96×96) maps, **Land** or **Fjords** terrain, and 1–3 computer foes. With two or more foes, choose **Allied** (they all fight you) or **Free-for-all** (everyone fights everyone). Games with 3–4 sides use a mirrored map with a base in each corner.
- **Computer opponent** with Beginner, Easy, Normal and Hard settings. It runs an economy, builds a base, defends itself and attacks in growing waves.
- Fog of war, minimap, control groups, attack-move, rally points, hold position, and procedurally generated mirrored maps.

## Play on a phone or tablet

Open the GitHub Pages link in Safari (iPhone/iPad) or Chrome (Android) and add it to your home screen:

- **iPhone / iPad:** Share button → **Add to Home Screen**.
- **Android:** ⋮ menu → **Add to Home screen** / **Install app**.

It then opens full screen from its own icon, like an app, and works offline after the first visit. Play with the phone held sideways.

| Touch | Action |
|---|---|
| Tap | Select a unit, or command the selected units (move, attack, mine, chop, repair) |
| Double-tap a unit | Select all of that type on screen |
| Drag | Scroll the map |
| Pinch | Zoom |
| Hold, then drag | Selection box (hold and release to deselect) |
| Tap a button | Use it and show what it does |

## Controls

| Input | Action |
|---|---|
| Left-click / drag | Select (Shift adds) |
| Double-click | Select all of a type on screen |
| Right-click | Move / attack / gather / return goods / set rally point |
| `A` then click | Attack-move |
| `B` | Build menu (workers) |
| `E` then click | Repair a damaged building (workers) / heal (casters) |
| `U`, `T` | Summon / storm (casters) |
| `R` | Hero ability (when a hero is selected) |
| `Ctrl+1–9`, `1–9` | Control groups (tap twice to jump) |
| `.` | Cycle idle workers |
| `Space` | Jump to last attack or to the selection |
| Arrows / screen edge / middle-drag / wheel | Scroll |
| `+` / `-`, ctrl+wheel | Zoom |
| `P` / `F10` | Pause · `F1` help |

## Code layout

| File | Purpose |
|---|---|
| `js/data.js` | Unit, building, upgrade and difficulty stats |
| `js/map.js` | Seeded noise and symmetric map generation |
| `js/path.js` | A* pathfinding and nearest-tile searches |
| `js/game.js` | Simulation: orders, combat, gathering, production, fog |
| `js/ai.js` | Computer opponent |
| `js/render.js` | Procedural terrain, sprites, effects, minimap |
| `js/ui.js` | Input, selection, command card, info panel |
| `js/main.js` | Game loop, synthesized music and voices, menus |
| `js/save.js` | Save, load and autosave |
| `js/tutorial.js` | The guided tutorial mission |
| `js/campaign.js` | Campaign chapters, briefings and progress |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |

Debug URL flags: `?autostart`, `?reveal` (no fog), `?ai=normal` (the computer plays your side too), `&speed=4`, `&faction=jotnar`.

Norsecraft is a fan project. It is not affiliated with Blizzard Entertainment and uses none of its assets.
