# Crownshire

A medieval pixel-art **four-kingdom free-for-all RTS** for desktop and mobile browsers.
You and three AI kingdoms start as small settlements in Crownshire Valley and grow into rival
powers through territory, economy and war. The AI kingdoms fight each other as much as they
fight you, so every match tells a different story.

Every sprite, tile, sound effect and piece of music is generated procedurally at run time.
There are no binary assets, and the art pipeline is set up so hand-made sprite sheets can be
swapped in later.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm test           # simulation tests (vitest)
npm run sim -- 3 25 ai   # headless AI-vs-AI match: seed, minutes
```

URL options for development: `?quick` skips the menu and intro, `?spectate` watches four AIs
play (the top bar shows every kingdom's standing), `?reveal` lifts the fog of war, `?seed=123`
fixes the map variation, `?tutorial` forces the tutorial and `?intro` plays the intro after `?quick`.

## How to play

- **Win** by *Domination* (hold 70% of the regions for 90 s) or *Elimination* (destroy every rival
  Capital Castle). A kingdom that loses its capital has 60 s to crown a new one in a surviving town;
  without a town it falls.
- **Capture** regions by standing troops on their capture point. Towns and castles must be breached first.
- **Build** on the plots of your settlements. **Upgrade** villages into towns and castle towns to
  unlock more plots, buildings and elite troops.
- **Trade** at a Market to turn surplus goods into gold or the reverse. With no market, your
  capital's royal caravans still trade, at poor rates.
- **Counters:** spears beat cavalry, cavalry beats archers, archers beat slow infantry, shields beat
  archers, siege beats walls, and fast units beat siege.

Desktop controls: left-click to select, drag to box-select, right-click to move or attack. Hotkeys
are A (attack-move), M (move), G (defend), F (formation), Ctrl+1–9 / 1–9 (armies) and Space (last alert).

Mobile controls: tap to select, drag from your troops to box-select, tap the ground to move and tap
an enemy to attack. One finger on empty ground pans the camera; two fingers pan and pinch-zoom.

## Architecture

```
src/
  core/     EventBus, seeded Random, math, Settings persistence
  data/     data-driven definitions: units, buildings, upgrades, factions, settlements, the Crownshire map
  sim/      pure simulation (no DOM/Phaser; runs headless in Node)
    map/        MapGen (terrain, regions, roads, plots), Pathfinder (A* + breach), RegionGraph
    units/      Unit, Movement (steering/collision), Formation, Combat (projectiles, counters), Morale
    economy/    Economy (income/pop), Workers (civilians that staff buildings and flee raids)
    territory/  Settlement, Capture
    ai/         AIController (strategy, squads, diplomacy), AIEconomy, AIMilitary, Intel (fog-limited knowledge)
    fog/        Visibility
    events/     WorldEvents (gold veins, bandit raids, harvests, fairs, mercenaries, treasure)
    Settlements.ts, Walls.ts, Diplomacy.ts, Victory.ts, World.ts
  render/   Phaser scene + renderers (terrain chunks painted in workers, y-sorted objects, units,
            buildings, territory, fog, particles, FX, ambient life, weather) and procedural art in render/art
  input/    unified mouse/touch gestures, selection & army groups
  ui/       DOM HUD (minimap, panels, action bar, notifications) and menus
  audio/    procedural WebAudio SFX, ambience and adaptive music
  game/     App flow, GameClient (sim ↔ renderer ↔ UI), intro cinematic, tutorial
tools/      headless match runner and art preview tools (PNG contact sheets)
tests/      vitest simulation tests
```

The simulation runs at a fixed 30 Hz with interpolated rendering. AI kingdoms see only what their
own fog of war shows them and pay the same costs as the player. Only Warlord difficulty gets a
documented +15% income bonus; Casual AIs get −15%. They trade through the same markets and royal
caravans as the player. AI-only matches typically resolve in about 25–35 minutes; with a human
pressing the pace, a match runs about 15–25.
