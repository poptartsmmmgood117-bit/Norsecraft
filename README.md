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

- **Economy:** mine gold and chop lumber with workers. Build farms for food (each unit costs 1).
- **Two mirrored factions**, each with its own units and buildings:

| Role | Vikings | Jötnar | Needs |
|---|---|---|---|
| Worker | Thrall | Drudge | — |
| Melee | Huscarl | Frost Troll | — |
| Ranged | Bowman | Ice Hurler | Lumber workshop |
| Rider | Valkyrie | Wolf Rider | Stable |
| Siege | Ballista | Stone Giant | Forge |

| Building | Vikings | Jötnar |
|---|---|---|
| Town hall | Longhouse | Frost Hall |
| Farm | Homestead | Rime Pen |
| Barracks | Mead Hall | Giant's Lodge |
| Lumber workshop | Woodwright | Ice Carver |
| Stable | Stable | Wolf Den |
| Forge | Smithy | Frost Forge |
| Tower | Watchtower | Ice Spire |

- **Upgrades:** Runed Blades, Iron Mail and Barbed Arrows.
- **Computer opponent** with Easy, Normal and Hard settings. It runs an economy, builds a base, defends itself and attacks in growing waves.
- Fog of war, minimap, control groups, attack-move, rally points, hold position, and procedurally generated mirrored maps.

## Controls

| Input | Action |
|---|---|
| Left-click / drag | Select (Shift adds) |
| Double-click | Select all of a type on screen |
| Right-click | Move / attack / gather / return goods / set rally point |
| `A` then click | Attack-move |
| `B` | Build menu (workers) |
| `Ctrl+1–9`, `1–9` | Control groups (tap twice to jump) |
| `.` | Cycle idle workers |
| `Space` | Jump to last attack or to the selection |
| Arrows / screen edge / middle-drag / wheel | Scroll |
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
| `js/main.js` | Game loop, synthesized audio, menus |

Debug URL flags: `?autostart`, `?reveal` (no fog), `?ai=normal` (the computer plays your side too), `&speed=4`, `&faction=jotnar`.

Norsecraft is a fan project. It is not affiliated with Blizzard Entertainment and uses none of its assets.
