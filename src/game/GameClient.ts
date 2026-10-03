import { word } from '../data/era';
import Phaser from 'phaser';
import { audio, music } from '../audio';
import { settings } from '../core/Settings';
import { EventBus } from '../core/EventBus';
import { BUILDINGS } from '../data/buildings';
import { NEUTRAL, TILE, type FactionId } from '../data/constants';
import type { InputHooks } from '../input/InputController';
import { Selection } from '../input/Selection';
import type { CameraController } from '../render/CameraController';
import { GameScene } from '../render/GameScene';
import { AUTO_POLICY, type AIController, type AutoPolicy } from '../sim/ai/AIController';
import { createMatchWorld } from '../sim/save/SaveGame';
import type { FormationKind } from '../sim/units/Formation';
import type { Unit } from '../sim/units/Unit';
import { World, type MatchSetup } from '../sim/World';

export interface ClientEvents {
  toast: { text: string; error?: boolean };
  selection: Record<string, never>;
  openBuild: { region: number; plot: number };
  mode: { mode: string };
  paused: { paused: boolean };
  armies: Record<string, never>;
  ready: Record<string, never>;
  matchEnd: { winner: number; reason: string };
  cinematic: { on: boolean };
}

/**
 * Glue between the simulation, the Phaser renderer and the DOM UI for one match.
 * All player commands go through here so feedback (sounds, toasts) is consistent.
 */
export class GameClient {
  world: World;
  selection: Selection;
  game: Phaser.Game | null = null;
  scene: GameScene | null = null;
  paused = false;
  speed = 1;
  dpr = 1;
  formation: FormationKind;
  readonly playerFaction: number;
  readonly ui = new EventBus<ClientEvents>();
  private readyCbs: ((s: GameScene) => void)[] = [];
  private frameCbs: ((dt: number, s: GameScene) => void)[] = [];
  cinematic = false;
  lastAlert: { x: number; y: number; t: number } | null = null;

  constructor(
    setup: MatchSetup,
    private parent: HTMLElement,
    /** a world restored from a save game */
    loaded?: World,
  ) {
    this.world = loaded ?? createMatchWorld(setup);
    this.playerFaction = setup.player;
    this.selection = new Selection(this.world);
    this.formation = settings.data.formation;
    this.selection.onChange(() => this.ui.emit('selection', {}));
    this.world.events.on('notice', (n) => {
      if (n.alarm && n.x !== undefined && n.y !== undefined) this.lastAlert = { x: n.x, y: n.y, t: this.world.time };
    });
    this.world.events.on('matchOver', (e) => this.ui.emit('matchEnd', { winner: e.winner, reason: e.reason }));
    // the first capture explains how to read the map
    this.world.events.on('regionCaptured', (e) => {
      if (e.to !== this.playerFaction || this.firstCaptureHint) return;
      this.firstCaptureHint = true;
      const col = this.world.factions[this.playerFaction]?.color.id ?? '';
      setTimeout(() => this.toast(`Land tinted ${col} is yours. Other colours are rival ${word('kingdoms')} (see ${word('KINGDOMS')}, top right); untinted land is unclaimed.`), 3500);
    });
  }

  start() {
    this.dpr = Math.min(window.devicePixelRatio || 1, settings.data.graphics === 'low' ? 1 : 2);
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.parent,
      width: Math.round(w * this.dpr),
      height: Math.round(h * this.dpr),
      backgroundColor: '#1a1420',
      pixelArt: true,
      antialias: false,
      roundPixels: false,
      disableContextMenu: true,
      banner: false,
      fps: { target: 60, smoothStep: false },
      input: { mouse: false, touch: false, keyboard: false, gamepad: false },
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / this.dpr },
      render: { powerPreference: 'high-performance', batchSize: 4096 },
      scene: [],
    });
    this.game.scene.add('game', GameScene, true, { client: this });
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private onResize = () => {
    if (!this.game) return;
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    this.game.scale.resize(Math.round(w * this.dpr), Math.round(h * this.dpr));
    this.game.scale.setZoom(1 / this.dpr);
  };

  onReady(cb: (s: GameScene) => void) {
    if (this.scene) cb(this.scene);
    else this.readyCbs.push(cb);
  }

  onFrame(cb: (dt: number, s: GameScene) => void) {
    this.frameCbs.push(cb);
  }

  onSceneReady(s: GameScene) {
    this.scene = s;
    for (const cb of this.readyCbs) cb(s);
    this.readyCbs = [];
    this.ui.emit('ready', {});
  }

  frame(dt: number, s: GameScene) {
    for (const cb of this.frameCbs) cb(dt, s);
    const c = s.camCtl;
    audio.setListener(c.x, c.y, c.viewW / c.zoom, c.viewH / c.zoom, c.zoom);
    audio.update(dt);
    music.update(dt);
    if (this.world.tick % 15 === 0) this.selection.prune();
    this.borderT -= dt;
    if (this.borderT <= 0) {
      this.borderT = 0.5;
      this.checkBorders();
    }
  }

  private borderT = 0;
  private unitRegion = new Map<number, number>();
  private borderSaid = new Map<number, number>();
  private firstCaptureHint = false;

  /** tell the player when their troops march into another kingdom's land (or unclaimed land) */
  private checkBorders() {
    const w = this.world;
    const pf = this.playerFaction;
    if (pf < 0 || this.cinematic) return;
    const m = w.map;
    const seen = new Set<number>();
    for (const u of w.units) {
      if (!u.alive || u.faction !== pf || u.def.special === 'worker') continue;
      seen.add(u.id);
      const tx = Math.floor(u.x / TILE);
      const ty = Math.floor(u.y / TILE);
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
      const rid = m.region[ty * m.w + tx];
      const prev = this.unitRegion.get(u.id);
      this.unitRegion.set(u.id, rid);
      if (prev === undefined || prev === rid) continue;
      const s = w.settlements[rid];
      const before = w.settlements[prev]?.owner;
      if (s.owner === pf || s.owner === before) continue;
      // one line per owner every 40 s
      if ((this.borderSaid.get(s.owner) ?? -99) > w.time - 40) continue;
      this.borderSaid.set(s.owner, w.time);
      if (s.owner === NEUTRAL) this.toast(`Entering unclaimed land: ${s.name}`);
      else {
        const f = w.factions[s.owner];
        const st = w.diplomacy.stance(pf as FactionId, s.owner as FactionId);
        const rel = st === 'war' ? 'at war' : st === 'ceasefire' ? 'truce' : st === 'hostile' ? 'hostile' : 'at peace';
        this.toast(`Entering ${f.name}'s land (${f.color.id}, ${rel}): ${s.name}`);
      }
    }
    for (const id of this.unitRegion.keys()) if (!seen.has(id)) this.unitRegion.delete(id);
  }

  applyCameraSettings(c: CameraController) {
    c.sensitivity = settings.data.cameraSensitivity;
    c.edgeScroll = settings.data.edgeScroll;
    c.shakeEnabled = settings.data.screenShake;
  }

  startFocus(): [number, number] {
    const f = this.world.player ?? this.world.factions[0];
    const r = this.world.capitalRegion(f.id as FactionId);
    if (r) return [r.cx * TILE + 8, r.cy * TILE + 30];
    return [this.world.map.w * 8, this.world.map.h * 8];
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) audio.suspend();
    else audio.resume();
    this.ui.emit('paused', { paused: p });
  }

  toast(text: string, error = false) {
    this.ui.emit('toast', { text, error });
    if (error) audio.play('ui_error');
  }

  focus(x: number, y: number, zoom?: number) {
    this.scene?.camCtl.flyTo(x, y, zoom, 0.6);
  }

  // ------------------------------------------------------------------ commands
  private pf() {
    return this.playerFaction as FactionId;
  }

  cmdBuild(region: number, plot: number, type: string): boolean {
    const sys = this.world.settlementSys;
    let p = plot;
    if (p < 0) {
      // auto-pick the best free plot for this building
      const s = this.world.settlements[region];
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < s.unlockedPlots; i++) {
        if (s.plots[i].buildingId) continue;
        if (!sys.meetsRequirement(s, i, BUILDINGS[type]).ok) continue;
        // keep deposit/forest plots for buildings that need them
        let sc = -i * 0.1;
        if (!BUILDINGS[type].requires) {
          if (sys.meetsRequirement(s, i, BUILDINGS.mine).ok) sc -= 3;
          if (sys.meetsRequirement(s, i, BUILDINGS.lumber_camp).ok) sc -= 1;
        }
        if (BUILDINGS[type].requires === 'forest') sc += sys.countTrees(s.plots[i].def.x + 1.5, s.plots[i].def.y + 1.5) * 0.2;
        if (sc > bestScore) {
          bestScore = sc;
          best = i;
        }
      }
      if (best < 0) {
        this.toast(BUILDINGS[type].requires === 'forest' ? 'No plot near a forest' : BUILDINGS[type].requires === 'mineral' ? 'No plot near a deposit' : 'No free plot — upgrade the settlement', true);
        return false;
      }
      p = best;
    }
    const r = sys.build(this.pf(), region, p, type);
    if (!r.ok) {
      this.toast(r.reason ?? 'Cannot build', true);
      return false;
    }
    audio.play('ui_click');
    return true;
  }

  cmdRecruit(buildingId: number, type: string): boolean {
    const r = this.world.settlementSys.recruit(this.pf(), buildingId, type);
    if (!r.ok) {
      this.toast(r.reason ?? 'Cannot recruit', true);
      return false;
    }
    audio.play('recruit', { volume: 0.6 });
    return true;
  }

  cmdCancel(buildingId: number, idx: number) {
    this.world.settlementSys.cancelTrain(this.pf(), buildingId, idx);
    audio.play('ui_close');
  }

  cmdUpgrade(region: number) {
    const r = this.world.settlementSys.upgrade(this.pf(), region);
    if (!r.ok) return this.toast(r.reason ?? 'Cannot upgrade', true);
    audio.play('build_place');
    this.toast(`${this.world.settlements[region].name} is being upgraded`);
  }

  cmdFortify(region: number) {
    const r = this.world.settlementSys.fortifyCmd(this.pf(), region);
    if (!r.ok) return this.toast(r.reason ?? 'Cannot fortify', true);
    audio.play('build_place');
  }

  cmdResearch(buildingId: number, id: string) {
    const r = this.world.settlementSys.research(this.pf(), buildingId, id);
    if (!r.ok) return this.toast(r.reason ?? 'Cannot research', true);
    audio.play('ui_click');
  }

  cmdTrade(res: 'wood' | 'food' | 'stone', buy: boolean) {
    const r = this.world.settlementSys.trade(this.pf(), res, buy);
    if (!r.ok) return this.toast(r.reason ?? 'Cannot trade', true);
    audio.play('coins');
  }

  cmdDemolish(buildingId: number) {
    const r = this.world.settlementSys.demolish(this.pf(), buildingId);
    if (!r.ok) return this.toast(r.reason ?? 'Cannot demolish', true);
    this.selection.clear();
  }

  cmdHold() {
    const ids = [...this.selection.units];
    if (!ids.length) return;
    this.world.takeCommand(ids);
    this.world.orderHold(ids);
    audio.play('order_move');
    this.toast('Holding position');
  }

  /** the player's self-running armies (null when switched off at setup) */
  get autopilot(): AIController | null {
    return (this.world.ai as { autopilot?: AIController | null } | null)?.autopilot ?? null;
  }

  cmdAutoPolicy() {
    const ap = this.autopilot;
    if (!ap) return;
    const order: AutoPolicy[] = ['expand', 'conquer', 'defend', 'off'];
    ap.policy = order[(order.indexOf(ap.policy) + 1) % order.length];
    audio.play('ui_click');
    this.toast(AUTO_POLICY[ap.policy].toast);
  }

  /** selected soldiers go back to thinking for themselves */
  cmdRelease() {
    const ids = this.selection.unitList().filter((u) => u.faction === this.playerFaction && u.def.special !== 'worker').map((u) => u.id);
    if (!ids.length) return;
    this.world.releaseCommand(ids);
    audio.play('order_move');
    this.toast(ids.length > 1 ? `${ids.length} soldiers will use their own judgement` : 'They will use their own judgement');
  }

  cmdStop() {
    const ids = [...this.selection.units];
    this.world.takeCommand(ids);
    this.world.orderStop(ids);
    audio.play('ui_click');
  }

  cycleFormation() {
    const order: FormationKind[] = ['line', 'wedge', 'defensive', 'loose'];
    this.formation = order[(order.indexOf(this.formation) + 1) % order.length];
    settings.set('formation', this.formation);
    audio.play('ui_click');
    this.toast(`Formation: ${this.formation.toUpperCase()}`);
    // re-form in place if units are selected and idle
    const units = this.selection.unitList().filter((u) => u.def.special !== 'worker');
    if (units.length > 1) {
      let cx = 0;
      let cy = 0;
      for (const u of units) {
        cx += u.destX;
        cy += u.destY;
      }
      this.world.orderMove(units.map((u) => u.id), cx / units.length, cy / units.length, { formation: this.formation, attackMove: true });
    }
  }

  createArmy(): number {
    const ids = this.selection.unitList().filter((u) => u.def.special !== 'worker').map((u) => u.id);
    if (!ids.length) return 0;
    // if every selected unit is already one army, keep it
    const n = this.selection.nextFreeArmy();
    if (!n) {
      this.toast('All nine army banners are in use', true);
      return 0;
    }
    this.selection.assignArmy(n, ids);
    audio.play('horn_recruit', { volume: 0.5 });
    this.ui.emit('armies', {});
    return n;
  }

  selectAllMilitary() {
    const ids = this.world.units.filter((u) => u.alive && u.faction === this.playerFaction && u.def.special !== 'worker').map((u) => u.id);
    this.selection.setUnits(ids);
    if (ids.length) audio.play('select_army');
  }

  selectIdle() {
    const ids = this.world.units
      .filter((u) => u.alive && u.faction === this.playerFaction && u.def.special !== 'worker' && u.arrived && !u.targetId && u.order.kind === 'idle')
      .map((u) => u.id);
    if (!ids.length) return this.toast('No idle troops');
    this.selection.setUnits(ids);
    const u = this.world.unitById.get(ids[0])!;
    this.focus(u.x, u.y);
  }

  jumpToAlert() {
    if (this.lastAlert) this.focus(this.lastAlert.x, this.lastAlert.y);
  }

  jumpCapital() {
    const f = this.world.player;
    if (!f) return;
    const s = f.capitalSettlement >= 0 ? this.world.settlements[f.capitalSettlement] : null;
    if (s) this.focus(s.cx, s.cy + 20);
  }

  // ------------------------------------------------------------------ picking / input hooks
  pickStructure(x: number, y: number): ReturnType<InputHooks['pickStructure']> {
    const w = this.world;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    // empty plots of a selected own settlement
    const selRegion = this.selection.region >= 0 ? this.selection.region : this.selection.building ? w.buildingById.get(this.selection.building)?.settlementId ?? -1 : -1;
    if (selRegion >= 0) {
      const s = w.settlements[selRegion];
      if (s.owner === this.playerFaction) {
        for (let i = 0; i < s.unlockedPlots; i++) {
          const p = s.plots[i];
          if (p.buildingId) continue;
          if (tx >= p.def.x && ty >= p.def.y && tx < p.def.x + p.def.size && ty < p.def.y + p.def.size) return { kind: 'plot', region: s.id, plot: i };
        }
      }
    }
    // buildings (include the roof area above the footprint)
    let best: { id: number; region: number; d: number } | null = null;
    w.buildingHash.query(x, y, 64, (b) => {
      if (b.destroyed) return;
      if (b.faction !== this.playerFaction && !w.vis.isExplored(this.playerFaction, b.x, b.y)) return;
      const x0 = b.tx * TILE;
      const y0 = b.ty * TILE - (b.size >= 3 ? 14 : 8);
      const x1 = (b.tx + b.size) * TILE;
      const y1 = (b.ty + b.size) * TILE;
      if (x < x0 || x > x1 || y < y0 || y > y1) return;
      const d = Math.hypot(b.x - x, b.y - y) + (b.def.id === 'wall' || b.def.id === 'gatehouse' ? 30 : 0);
      if (!best || d < best.d) best = { id: b.id, region: b.settlementId, d };
    });
    if (best) {
      const b = best as { id: number; region: number };
      return { kind: 'building', id: b.id, region: b.region };
    }
    // the settlement square itself
    for (const s of w.settlements) {
      if (Math.hypot(s.px - x, s.py - y) < 24) return { kind: 'region', id: s.id };
    }
    return null;
  }

  inputHooks(scene: GameScene): InputHooks {
    return {
      order: (kind, x, y, target?: Unit) => {
        const ids = this.selection.unitList().filter((u) => u.faction === this.playerFaction).map((u) => u.id);
        if (!ids.length) return;
        this.world.takeCommand(ids.filter((id) => this.world.unitById.get(id)?.def.special !== 'worker'));
        if (kind === 'attack' && target) {
          this.world.orderAttack(ids, target.id);
          scene.addMarker(target.x, target.y, 'attack');
          audio.play('order_attack');
          return;
        }
        // tapping an enemy building attacks it
        const s = this.pickStructure(x, y);
        if (s && s.kind === 'building') {
          const b = this.world.buildingById.get(s.id)!;
          if (b.faction !== this.playerFaction && b.def.category !== 'landmark' && b.def.id !== 'merc_camp') {
            this.world.orderAttack(ids, b.id);
            scene.addMarker(b.x, b.y, 'attack');
            audio.play('order_attack');
            return;
          }
          if (b.def.id === 'merc_camp') {
            this.world.orderMove(ids, b.doorX, b.doorY + 12, { formation: this.formation });
            scene.addMarker(b.doorX, b.doorY + 12, 'move');
            audio.play('order_move');
            return;
          }
        }
        this.world.orderMove(ids, x, y, { attackMove: kind === 'attackMove', formation: this.formation });
        scene.addMarker(x, y, kind === 'attackMove' ? 'attack' : 'move');
        audio.play(kind === 'attackMove' ? 'order_attack' : 'order_move');
      },
      pickStructure: (x, y) => this.pickStructure(x, y),
      plotTapped: (region, plot) => {
        audio.play('ui_open');
        this.ui.emit('openBuild', { region, plot });
      },
      groundTarget: (mode, x, y) => {
        if (mode === 'rally' && this.selection.building) {
          const b = this.world.buildingById.get(this.selection.building);
          if (b && b.faction === this.playerFaction) {
            this.world.settlementSys.setRally(this.pf(), b.id, x, y);
            scene.addMarker(x, y, 'move');
            audio.play('ui_click');
            this.toast('Rally point set');
            return true;
          }
        }
        return false;
      },
      selected: () => {
        if (this.selection.units.size) audio.play(this.selection.units.size > 4 ? 'select_army' : 'select');
        else if (this.selection.building || this.selection.region >= 0) audio.play('ui_click');
      },
      interact: () => audio.init(),
      modeConsumed: () => this.ui.emit('mode', { mode: 'default' }),
      selectSameType: (u) => {
        const v = scene.camCtl.view(0);
        const ids = this.world.units
          .filter((o) => o.alive && o.faction === u.faction && o.def.id === u.def.id && o.x > v.x0 && o.x < v.x1 && o.y > v.y0 && o.y < v.y1)
          .map((o) => o.id);
        this.selection.setUnits(ids);
      },
    };
  }

  setMode(mode: 'default' | 'move' | 'attack' | 'select' | 'rally') {
    if (this.scene) this.scene.input2.mode = mode;
    this.ui.emit('mode', { mode });
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.scene?.input2.destroy();
    this.scene?.terrain.destroy();
    this.game?.destroy(true);
    this.game = null;
  }
}
