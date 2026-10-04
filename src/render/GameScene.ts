import Phaser from 'phaser';
import { settings } from '../core/Settings';
import { NEUTRAL, SIM_DT, TILE } from '../data/constants';
import type { GameClient } from '../game/GameClient';
import { InputController } from '../input/InputController';
import { Ambient } from './Ambient';
import { buildAmbientArt } from './art/animalArt';
import { art } from './art/ArtRegistry';
import { buildFactionArt, buildPostArt, buildStaticArt } from './art/buildArt';
import { buildFxArt } from './art/fxArt';
import { BuildingRenderer } from './BuildingRenderer';
import { CameraController } from './CameraController';
import { FogRenderer } from './FogRenderer';
import { FxDirector } from './FxDirector';
import { Particles } from './Particles';
import { TerrainRenderer } from './TerrainRenderer';
import { TerritoryRenderer } from './TerritoryRenderer';
import { SpeechRenderer } from './Speech';
import { UnitRenderer } from './UnitRenderer';
import { Weather } from './Weather';
import { WorldObjects } from './WorldObjects';
import { YSortLayer } from './YSortLayer';

let fxArtBuilt = false;

/**
 * The battlefield scene. Owns render subsystems and drives the fixed-step simulation with
 * interpolation. All game rules live in the sim (World); this only draws and forwards input.
 */
export class GameScene extends Phaser.Scene {
  client!: GameClient;
  camCtl!: CameraController;
  input2!: InputController;
  terrain!: TerrainRenderer;
  objects!: WorldObjects;
  units!: UnitRenderer;
  buildingsR!: BuildingRenderer;
  territory!: TerritoryRenderer;
  fog!: FogRenderer;
  particles!: Particles;
  fx!: FxDirector;
  speech!: SpeechRenderer;
  ambient!: Ambient;
  weather!: Weather;
  ysort!: YSortLayer;
  groundLayer!: Phaser.GameObjects.Layer;
  decalLayer!: Phaser.GameObjects.Layer;
  fxLayer!: Phaser.GameObjects.Layer;
  fogLayer!: Phaser.GameObjects.Layer;
  overLayer!: Phaser.GameObjects.Layer;
  selGfx!: Phaser.GameObjects.Graphics;
  barGfx!: Phaser.GameObjects.Graphics;
  stratGfx!: Phaser.GameObjects.Graphics;
  screenGfx!: Phaser.GameObjects.Graphics;
  uiCam!: Phaser.Cameras.Scene2D.Camera;
  private acc = 0;
  private markers: { x: number; y: number; t: number; kind: 'move' | 'attack' }[] = [];
  private labels = new Map<number, Phaser.GameObjects.Text>();
  /** "Claiming" / "Taking from X" captions over contested squares */
  private capLabels = new Map<number, Phaser.GameObjects.Text>();
  private armyTexts: Phaser.GameObjects.Text[] = [];
  renderTime = 0;
  frozenSim = false;

  constructor() {
    super('game');
  }

  init(data: { client: GameClient }) {
    this.client = data.client;
  }

  create() {
    const world = this.client.world;
    const pf = this.client.playerFaction;
    buildStaticArt();
    if (!fxArtBuilt) {
      buildFxArt();
      buildAmbientArt();
      fxArtBuilt = true;
    }
    buildFactionArt(world);
    buildPostArt(world);
    art.build(this, 'atlas_' + Date.now().toString(36) + '_');

    this.groundLayer = this.add.layer().setDepth(0);
    this.decalLayer = this.add.layer().setDepth(1);
    this.selGfx = this.make.graphics({}, false);
    this.ysort = new YSortLayer(this.add.layer().setDepth(2));
    this.fxLayer = this.add.layer().setDepth(3);
    this.fogLayer = this.add.layer().setDepth(4);
    this.overLayer = this.add.layer().setDepth(5);
    this.barGfx = this.make.graphics({}, false);
    this.stratGfx = this.make.graphics({}, false);
    this.overLayer.add([this.barGfx, this.stratGfx]);
    this.screenGfx = this.add.graphics().setDepth(10);
    // the valley fades into the dark at the map edge instead of stopping at a hard line
    {
      const wpx = world.map.w * TILE;
      const hpx = world.map.h * TILE;
      const e = 56;
      const bg = 0x1a1420;
      const g = this.make.graphics({}, false);
      g.fillGradientStyle(bg, bg, bg, bg, 0.95, 0.95, 0, 0);
      g.fillRect(0, 0, wpx, e);
      g.fillGradientStyle(bg, bg, bg, bg, 0, 0, 0.95, 0.95);
      g.fillRect(0, hpx - e, wpx, e);
      g.fillGradientStyle(bg, bg, bg, bg, 0.95, 0, 0.95, 0);
      g.fillRect(0, 0, e, hpx);
      g.fillGradientStyle(bg, bg, bg, bg, 0, 0.95, 0, 0.95);
      g.fillRect(wpx - e, 0, e, hpx);
      this.fogLayer.add(g);
    }

    const map = world.map;
    this.terrain = new TerrainRenderer(this, map, this.groundLayer);
    this.territory = new TerritoryRenderer(this, world, this.decalLayer);
    this.decalLayer.add(this.selGfx);
    this.territory.ylayer = this.ysort;
    this.territory.symbols = settings.data.colorblindSymbols;
    this.territory.rebuildAllPosts();
    this.objects = new WorldObjects(this, world, this.ysort);
    this.units = new UnitRenderer(this, world, this.ysort);
    this.particles = new Particles(this, this.fxLayer);
    this.buildingsR = new BuildingRenderer(this, world, this.ysort, this.particles);
    this.fog = new FogRenderer(this, world, pf, this.fogLayer);
    this.ambient = new Ambient(this, world, this.ysort, this.fxLayer);
    this.ambient.fx = this.particles;

    const cam = this.cameras.main;
    cam.setRoundPixels(false);
    cam.setBackgroundColor('#1a1420');
    this.camCtl = new CameraController(cam, map.w * TILE, map.h * TILE);
    this.camCtl.dpr = this.client.dpr;
    this.camCtl.updateLimits();
    this.client.applyCameraSettings(this.camCtl);
    this.fx = new FxDirector(this, world, this.particles, this.camCtl, this.fxLayer, this.decalLayer);
    this.fx.playerFaction = pf;
    this.fx.onChop = (i) => this.objects.shakeTree(i);
    this.weather = new Weather(this, this.camCtl, this.particles, this.overLayer, world.setup.seed);
    this.weather.onChange = () => {
      this.objects.wind = this.weather.wind;
      this.ambient.wind = this.weather.wind;
    };
    this.buildingsR.playerFaction = pf;
    if (pf >= 0) {
      const bit = 1 << pf;
      this.units.visible = (u) => u.faction === pf || (u.seenBy & bit) !== 0;
      this.buildingsR.exploredTest = (x, y) => world.vis.isExplored(pf, x, y);
    }
    this.speech = new SpeechRenderer(this, world, this.overLayer, (u) => pf < 0 || u.faction === pf || world.vis.isVisible(pf, u.x, u.y));
    this.speech.playerFaction = pf;
    this.applyQuality();
    settings.onChange(() => this.applyQuality());

    this.input2 = new InputController(this.game.canvas, this.camCtl, world, this.client.selection, pf, this.client.inputHooks(this));

    // screen-space camera for overlays (selection box etc.)
    this.uiCam = this.cameras.add(0, 0, cam.width, cam.height, false, 'ui');
    this.uiCam.ignore([this.groundLayer, this.decalLayer, this.ysort.layer, this.fxLayer, this.fogLayer, this.overLayer]);
    cam.ignore(this.screenGfx);
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.camCtl.updateLimits();
      this.uiCam.setSize(size.width, size.height);
    });
    const [fx, fy] = this.client.startFocus();
    this.camCtl.x = fx;
    this.camCtl.y = fy;
    this.camCtl.zoom = this.camCtl.targetZoom = this.camCtl.normalZoom();
    this.terrain.prioritize(fx, fy);
    world.vis.update();
    this.fog.update(true);
    this.client.onSceneReady(this);
  }

  applyQuality() {
    const d = settings.data;
    if (this.territory && this.territory.symbols !== d.colorblindSymbols) {
      this.territory.symbols = d.colorblindSymbols;
      this.territory.rebuildAllPosts();
    }
    const q = d.reducedEffects ? 0.35 : d.graphics === 'low' ? 0.45 : d.graphics === 'medium' ? 0.75 : 1;
    this.particles.quality = q;
    this.ambient.quality = q;
    this.fx.reduced = d.reducedEffects;
    this.buildingsR.reduced = d.reducedEffects || d.graphics === 'low';
    this.fx.shakeScale = d.screenShake ? 1 : 0;
    this.camCtl.shakeEnabled = d.screenShake;
    this.client.applyCameraSettings(this.camCtl);
  }

  addMarker(x: number, y: number, kind: 'move' | 'attack') {
    this.markers.push({ x, y, t: 0, kind });
    if (this.markers.length > 8) this.markers.shift();
  }

  private lastNow = 0;

  override update(_time: number, _deltaMs: number) {
    // measure real frame time ourselves: Phaser's smoothed delta under-reports slow frames
    const now = performance.now();
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 1 / 60;
    this.lastNow = now;
    this.renderTime += dt;
    const client = this.client;
    const world = client.world;
    // ---- fixed-step sim
    if (!client.paused && !this.frozenSim) {
      this.acc += dt * client.speed;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 6) {
        world.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps >= 6) this.acc = Math.min(this.acc, SIM_DT);
    }
    const alpha = client.paused ? 1 : Math.min(1, this.acc / SIM_DT);
    this.camCtl.update(dt);
    this.terrain.update();
    const zoom = this.camCtl.zoom;
    const view = this.camCtl.view(24);
    const strategic = zoom < 0.95;
    this.objects.update(view, this.renderTime, dt);
    this.units.hidden = strategic;
    this.units.update(alpha, view);
    const simDt = client.paused ? 0 : dt;
    this.buildingsR.update(simDt, this.renderTime, view);
    this.ambient.update(simDt, this.renderTime, view, zoom);
    this.particles.update(simDt);
    this.fx.update(simDt, alpha);
    this.speech.update(simDt, zoom, alpha, this.renderTime);
    this.weather.enabled = !settings.data.reducedEffects;
    this.weather.update(simDt);
    this.territory.update(dt, zoom);
    this.fog.update();
    this.ysort.sort();
    this.drawSelection(alpha);
    this.drawSettlementOverlays(zoom);
    this.drawStrategic(strategic);
    this.drawScreenOverlay();
    client.frame(dt, this);
  }

  private selectedSettlement() {
    const sel = this.client.selection;
    const w = this.client.world;
    if (sel.region >= 0) return w.settlements[sel.region];
    if (sel.building) {
      const b = w.buildingById.get(sel.building);
      if (b) return w.settlements[b.settlementId];
    }
    return null;
  }

  private drawSelection(alpha: number) {
    const g = this.selGfx;
    g.clear();
    const bars = this.barGfx;
    bars.clear();
    const world = this.client.world;
    const sel = this.client.selection;
    const zoom = this.camCtl.zoom;
    const lw = Math.max(1, 1.2 / zoom);
    const pf = this.client.playerFaction;
    for (const id of sel.units) {
      const u = world.unitById.get(id);
      if (!u) continue;
      const x = u.px + (u.x - u.px) * alpha;
      const y = u.py + (u.y - u.py) * alpha;
      const rx = u.radius + 2.5;
      const own = u.faction === pf;
      g.lineStyle(lw * 1.6, 0x101018, 0.45);
      g.strokeEllipse(x, y + 0.5, rx * 2 + 1, rx + 1.5);
      g.lineStyle(lw, own ? 0xf8f0a0 : 0xff8070, 0.95);
      g.strokeEllipse(x, y, rx * 2, rx);
    }
    // building levels: gold pips; an improvement in progress shows a bar
    if (zoom >= 1) {
      const v = this.camCtl.view(20);
      for (const b of world.buildings) {
        if (b.destroyed || (b.level <= 1 && b.levelUpT <= 0)) continue;
        if (b.x < v.x0 || b.x > v.x1 || b.y < v.y0 || b.y > v.y1) continue;
        if (pf >= 0 && b.faction !== pf && !world.vis.isExplored(pf, b.x, b.y)) continue;
        const bx = (b.tx + b.size) * TILE - 4;
        const by = (b.ty + b.size) * TILE - 3;
        const ps = 2.2;
        for (let k = 0; k < b.level - 1; k++) {
          const px = bx - k * (ps + 1.2);
          bars.fillStyle(0x1b1420, 0.9);
          bars.fillTriangle(px - ps - 0.8, by + 0.8, px + ps + 0.8, by + 0.8, px, by - ps - 1.2);
          bars.fillStyle(0xf0c84a, 1);
          bars.fillTriangle(px - ps, by, px + ps, by, px, by - ps);
        }
        if (b.levelUpT > 0) {
          const total = b.level === 1 ? 25 : 40;
          const f = 1 - b.levelUpT / total;
          const w = b.size * TILE * 0.6;
          const x0 = b.x - w / 2;
          const y0 = (b.ty + b.size) * TILE + 2;
          bars.fillStyle(0x1b1420, 0.85);
          bars.fillRect(x0 - lw, y0 - lw, w + lw * 2, 2.4 + lw * 2);
          bars.fillStyle(0xf0c84a, 1);
          bars.fillRect(x0, y0, w * f, 2.4);
        }
      }
    }
    // debug: show unit paths
    if (settings.data.debug) {
      g.lineStyle(lw, 0x80e0ff, 0.6);
      for (const id of sel.units) {
        const u = world.unitById.get(id);
        if (!u || !u.path) continue;
        let px = u.x;
        let py = u.y;
        for (let k = u.pathIdx; k < u.path.length / 2; k++) {
          g.lineBetween(px, py, u.path[k * 2], u.path[k * 2 + 1]);
          px = u.path[k * 2];
          py = u.path[k * 2 + 1];
        }
        if (u.targetId) {
          const t = world.unitById.get(u.targetId) ?? world.buildingById.get(u.targetId);
          if (t) {
            g.lineStyle(lw, 0xff6060, 0.7);
            g.lineBetween(u.x, u.y, t.x, t.y);
            g.lineStyle(lw, 0x80e0ff, 0.6);
          }
        }
      }
    }
    // selected building / settlement outline + its plots
    const s = this.selectedSettlement();
    if (sel.building) {
      const b = world.buildingById.get(sel.building);
      if (b && !b.destroyed) {
        g.lineStyle(lw * 1.4, b.faction === pf ? 0xf8f0a0 : 0xff8070, 0.85);
        g.strokeRect(b.tx * TILE + 0.5, b.ty * TILE + 0.5, b.size * TILE - 1, b.size * TILE - 1);
        if (b.hasRally && b.faction === pf) {
          g.lineStyle(lw, 0xf8f0a0, 0.6);
          g.lineBetween(b.doorX, b.doorY, b.rallyX, b.rallyY);
          g.fillStyle(0xf8f0a0, 0.9);
          g.fillCircle(b.rallyX, b.rallyY, 2.5);
        }
      }
    }
    if (s && s.owner === pf) {
      const t = this.renderTime;
      for (let i = 0; i < s.plots.length; i++) {
        const p = s.plots[i];
        if (p.buildingId) continue;
        const x = p.def.x * TILE;
        const y = p.def.y * TILE;
        const S = p.def.size * TILE;
        if (i < s.unlockedPlots) {
          const pulse = 0.55 + 0.25 * Math.sin(t * 4 + i);
          g.fillStyle(0xf8e8a0, 0.08 + pulse * 0.06);
          g.fillRect(x + 2, y + 2, S - 4, S - 4);
          g.lineStyle(lw, 0xf8e8a0, pulse);
          // dashed outline
          for (let k = 0; k < S - 4; k += 4) {
            g.lineBetween(x + 2 + k, y + 2, x + 2 + Math.min(k + 2, S - 4), y + 2);
            g.lineBetween(x + 2 + k, y + S - 2, x + 2 + Math.min(k + 2, S - 4), y + S - 2);
            g.lineBetween(x + 2, y + 2 + k, x + 2, y + 2 + Math.min(k + 2, S - 4));
            g.lineBetween(x + S - 2, y + 2 + k, x + S - 2, y + 2 + Math.min(k + 2, S - 4));
          }
          g.lineStyle(lw * 1.5, 0xf8e8a0, pulse);
          g.lineBetween(x + S / 2 - 4, y + S / 2, x + S / 2 + 4, y + S / 2);
          g.lineBetween(x + S / 2, y + S / 2 - 4, x + S / 2, y + S / 2 + 4);
        } else {
          g.lineStyle(lw, 0x8a7a60, 0.35);
          g.strokeRect(x + 3, y + 3, S - 6, S - 6);
        }
      }
    }
    // health bars for damaged or selected units (not at strategic zoom)
    if (zoom >= 1.1) {
      const v = this.camCtl.view(10);
      for (const u of world.units) {
        if (u.x < v.x0 || u.x > v.x1 || u.y < v.y0 || u.y > v.y1) continue;
        const selected = sel.units.has(u.id);
        // scratched veterans don't carry a bar forever: only fresh or serious wounds show
        if (!selected && (u.hp >= u.maxHp || (world.time - u.lastHitT > 6 && u.hp > u.maxHp * 0.6))) continue;
        if (u.def.special === 'worker' && !selected) continue;
        if (!this.units.visible(u)) continue;
        const x = u.px + (u.x - u.px) * alpha;
        const y = u.py + (u.y - u.py) * alpha;
        const h = u.def.look.mount ? 26 : u.def.look.engine === 'trebuchet' ? 40 : u.def.look.body === 'engine' ? 22 : 17;
        const bw = u.def.look.mount || u.def.look.body === 'engine' ? 14 : 10;
        const frac = Math.max(0, u.hp / u.maxHp);
        const bx = Math.round(x - bw / 2);
        const by = Math.round(y - h);
        bars.fillStyle(0x140c14, 0.85);
        bars.fillRect(bx - 0.5, by - 0.5, bw + 1, 2.5);
        const col = frac > 0.6 ? 0x6ad048 : frac > 0.3 ? 0xe8c040 : 0xe04838;
        bars.fillStyle(col, 1);
        bars.fillRect(bx, by, Math.max(0.5, bw * frac), 1.5);
        if (u.faction !== pf) {
          const fc = u.faction === NEUTRAL ? 0xb8a890 : Phaser.Display.Color.HexStringToColor(world.factions[u.faction].color.main).color;
          bars.fillStyle(fc, 1);
          bars.fillRect(bx - 2, by - 0.5, 1.5, 2.5);
        }
        if (u.routing > 0) {
          bars.fillStyle(0xf0f0f0, 1);
          bars.fillRect(bx + bw + 1, by - 3, 1, 4);
          bars.fillRect(bx + bw + 2, by - 3, 2, 2);
        }
      }
    }
    // order markers
    for (const m of this.markers) {
      m.t += 1 / 60;
      const k = m.t / 0.7;
      if (k > 1) continue;
      const col = m.kind === 'attack' ? 0xe85040 : 0xf8f0a0;
      const r = 3 + k * 6;
      g.lineStyle(lw * 1.3, col, 1 - k);
      g.strokeEllipse(m.x, m.y, r * 2, r);
      g.lineStyle(lw, col, (1 - k) * 0.7);
      g.strokeEllipse(m.x, m.y, r, r * 0.5);
    }
    this.markers = this.markers.filter((m) => m.t < 0.7);
  }

  /** capture bars over contested squares and settlement name labels */
  private drawSettlementOverlays(zoom: number) {
    const w = this.client.world;
    const g = this.barGfx;
    const pf = this.client.playerFaction;
    const v = this.camCtl.view(40);
    const lw = Math.max(1, 1 / zoom);
    const capSeen = new Set<number>();
    for (const s of w.settlements) {
      if (s.px < v.x0 || s.px > v.x1 || s.py < v.y0 || s.py > v.y1) continue;
      if (pf >= 0 && !w.vis.isExplored(pf, s.px, s.py)) continue;
      if ((s.capProgress > 0 && s.capFaction >= 0) || s.needsBreach) {
        const bw = 26 / Math.max(1, zoom * 0.6);
        const bh = 3 / Math.max(1, zoom * 0.5);
        const x = s.px - bw / 2;
        const y = s.py - 22;
        g.fillStyle(0x140c14, 0.85);
        g.fillRect(x - lw, y - lw, bw + lw * 2, bh + lw * 2);
        // tug of war: the current owner's colour fills what the attacker hasn't won yet
        const ownerCol = s.owner === NEUTRAL ? 0x8a8070 : Phaser.Display.Color.HexStringToColor(w.factions[s.owner].color.main).color;
        g.fillStyle(ownerCol, 0.75);
        g.fillRect(x, y, bw, bh);
        if (s.capFaction >= 0) {
          const c = Phaser.Display.Color.HexStringToColor(w.factions[s.capFaction].color.light).color;
          g.fillStyle(c, 1);
          g.fillRect(x, y, bw * s.capProgress, bh);
          // caption: who is taking it from whom
          if (zoom >= 0.9) {
            capSeen.add(s.id);
            let t = this.capLabels.get(s.id);
            if (!t) {
              t = this.make.text({ x: 0, y: 0, text: '', style: { fontFamily: 'Pixelify Sans', fontSize: '24px', color: '#ffffff', stroke: '#1b1420', strokeThickness: 6 } }, false);
              t.setOrigin(0.5, 1);
              this.overLayer.add(t);
              this.capLabels.set(s.id, t);
            }
            const cap = w.factions[s.capFaction];
            const who = s.capFaction === pf ? 'You' : cap.name;
            const txt = s.owner === NEUTRAL ? `${who}: claiming` : s.owner === pf ? `${who}: taking it from you!` : `${who}: taking from ${w.factions[s.owner].name}`;
            if (t.text !== txt) t.setText(txt);
            const col = cap.color.light;
            if (t.style.color !== col) t.setColor(col);
            t.setScale(12 / 24 / zoom).setPosition(s.px, y - lw * 2).setVisible(true);
          }
        }
        if (s.needsBreach) {
          g.fillStyle(0xff7060, 0.6 + 0.4 * Math.sin(this.renderTime * 6));
          g.fillRect(x, y + bh + lw * 2, bw, lw * 1.2);
        }
      }
    }
    for (const [id, t] of this.capLabels) if (!capSeen.has(id)) t.setVisible(false);
    // name labels in the owner's colour at every zoom (small up close)
    const showLabels = true;
    for (const s of w.settlements) {
      let t = this.labels.get(s.id);
      const explored = pf < 0 || w.vis.isExplored(pf, s.cx, s.cy);
      const on = showLabels && explored && s.cx > v.x0 && s.cx < v.x1 && s.cy > v.y0 && s.cy < v.y1;
      if (!on) {
        if (t) t.setVisible(false);
        continue;
      }
      if (!t) {
        t = this.make.text({ x: 0, y: 0, text: s.name, style: { fontFamily: 'Pixelify Sans', fontSize: '28px', color: '#fff4d6', stroke: '#1b1420', strokeThickness: 6 } }, false);
        t.setOrigin(0.5, 0);
        this.overLayer.add(t);
        this.labels.set(s.id, t);
      }
      const col = s.owner === NEUTRAL ? '#e8dcc0' : w.factions[s.owner].color.light;
      if (t.style.color !== col) t.setColor(col);
      // constant on-screen size (~11-15 css px)
      const close = zoom >= 1.35;
      const px = close ? (s.isCapital ? 11 : 9.5) : s.isCapital ? 15 : s.tier >= 3 ? 13 : s.tier === 0 ? 10 : 11.5;
      t.setAlpha(close ? 0.9 : 1);
      const sc = px / 28 / zoom;
      t.setScale(sc).setPosition(s.cx, s.cy - (s.region.coreSize * TILE) / 2 - 4 - px / zoom).setVisible(true);
      t.setText(s.isCapital ? `♛ ${s.name}` : s.name);
    }
  }

  /** at strategic zoom, armies become banner icons */
  private drawStrategic(on: boolean) {
    const g = this.stratGfx;
    g.clear();
    for (const t of this.armyTexts) t.setVisible(false);
    if (!on) return;
    const w = this.client.world;
    const pf = this.client.playerFaction;
    const zoom = this.camCtl.zoom;
    const cell = 72;
    const groups = new Map<string, { f: number; n: number; x: number; y: number; sel: boolean }>();
    for (const u of w.units) {
      if (!u.alive || u.def.special === 'worker') continue;
      if (pf >= 0 && u.faction !== pf && !(u.seenBy & (1 << pf))) continue;
      const key = `${u.faction}:${Math.floor(u.x / cell)}:${Math.floor(u.y / cell)}`;
      let gr = groups.get(key);
      if (!gr) groups.set(key, (gr = { f: u.faction, n: 0, x: 0, y: 0, sel: false }));
      gr.n++;
      gr.x += u.x;
      gr.y += u.y;
      if (this.client.selection.units.has(u.id)) gr.sel = true;
    }
    let ti = 0;
    const s = 1 / zoom;
    for (const gr of groups.values()) {
      const x = gr.x / gr.n;
      const y = gr.y / gr.n;
      const col = gr.f === NEUTRAL ? 0x8a7a64 : Phaser.Display.Color.HexStringToColor(w.factions[gr.f].color.main).color;
      const r = (gr.f === NEUTRAL ? 3.5 : 5 + Math.min(7, Math.sqrt(gr.n) * 1.6)) * s;
      // chamfered rects only: rounded shapes and circles get re-triangulated every frame
      const chamfer = (x0: number, y0: number, w: number, h: number, c: number) => {
        g.fillRect(x0 + c, y0, w - 2 * c, h);
        g.fillRect(x0, y0 + c, w, h - 2 * c);
      };
      if (gr.f === NEUTRAL) {
        g.fillStyle(0x1b1420, 0.6);
        chamfer(x - r - s, y - r - s, (r + s) * 2, (r + s) * 2, 1.5 * s);
        g.fillStyle(col, 0.7);
        chamfer(x - r, y - r, r * 2, r * 2, 1.5 * s);
        continue;
      }
      // shield-shaped banner
      if (gr.sel) {
        g.fillStyle(0xf8f0a0, 1);
        chamfer(x - r - 3 * s, y - r * 1.1 - 3 * s, r * 2 + 6 * s, r * 2.3 + 6 * s, 3 * s);
      }
      g.fillStyle(0x1b1420, 0.9);
      chamfer(x - r - s, y - r * 1.1 - s, (r + s) * 2, r * 2.3 + s * 2, 2 * s);
      g.fillStyle(col, 1);
      chamfer(x - r, y - r * 1.1, r * 2, r * 2.3, 2 * s);
      let t = this.armyTexts[ti];
      if (!t) {
        t = this.make.text({ x: 0, y: 0, text: '', style: { fontFamily: 'Pixelify Sans', fontSize: '24px', color: '#fff6e0', stroke: '#1b1420', strokeThickness: 5 } }, false);
        t.setOrigin(0.5, 0.5);
        this.overLayer.add(t);
        this.armyTexts.push(t);
      }
      ti++;
      t.setText(String(gr.n)).setPosition(x, y + r * 0.05).setScale(0.5 * s).setVisible(true);
    }
  }

  private drawScreenOverlay() {
    const g = this.screenGfx;
    g.clear();
    // soft vignette: draws the eye to the middle of the view
    {
      const W = this.scale.width;
      const H = this.scale.height;
      const ex = W * 0.14;
      const ey = H * 0.16;
      const c = 0x140e18;
      const a = 0.28;
      g.fillGradientStyle(c, c, c, c, a, a, 0, 0);
      g.fillRect(0, 0, W, ey);
      g.fillGradientStyle(c, c, c, c, 0, 0, a, a);
      g.fillRect(0, H - ey, W, ey);
      g.fillGradientStyle(c, c, c, c, a, 0, a, 0);
      g.fillRect(0, 0, ex, H);
      g.fillGradientStyle(c, c, c, c, 0, a, 0, a);
      g.fillRect(W - ex, 0, ex, H);
    }
    const b = this.input2.box;
    if (b) {
      const d = this.client.dpr;
      const x = Math.min(b.x0, b.x1) * d;
      const y = Math.min(b.y0, b.y1) * d;
      const w = Math.abs(b.x1 - b.x0) * d;
      const h = Math.abs(b.y1 - b.y0) * d;
      g.fillStyle(0xf8f0a0, 0.08);
      g.fillRect(x, y, w, h);
      g.lineStyle(1.5 * d, 0xf8f0a0, 0.9);
      g.strokeRect(x, y, w, h);
    }
    // the capital is under attack: the screen edge pulses red
    const w = this.client.world;
    const pf = this.client.playerFaction;
    const cap = pf >= 0 ? w.settlements[w.factions[pf]?.capitalSettlement ?? -1] : undefined;
    const since = cap && cap.owner === pf ? w.time - cap.lastAttackedT : 99;
    if (since < 4 && !this.client.cinematic) {
      const pulse = 0.5 + 0.5 * Math.sin(w.time * 6);
      const fade = Math.min(1, (4 - since) / 1.5);
      const W = this.scale.width;
      const H = this.scale.height;
      const band = Math.max(10, Math.min(W, H) * 0.035);
      for (let k = 0; k < 5; k++) {
        const a = (0.16 - k * 0.03) * fade * (0.6 + 0.4 * pulse);
        const t = band * (k / 5);
        const th = band / 5 + 0.5;
        g.fillStyle(0xd02018, a);
        g.fillRect(0, t, W, th);
        g.fillRect(0, H - t - th, W, th);
        g.fillRect(t, 0, th, H);
        g.fillRect(W - t - th, 0, th, H);
      }
    }
  }
}
