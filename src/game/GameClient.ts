import Phaser from 'phaser';
import { TILE, type FactionId } from '../data/constants';
import type { InputHooks } from '../input/InputController';
import { Selection } from '../input/Selection';
import type { CameraController } from '../render/CameraController';
import { GameScene } from '../render/GameScene';
import type { Unit } from '../sim/units/Unit';
import { World, type MatchSetup } from '../sim/World';
import { settings } from '../core/Settings';
import { audio } from '../audio';

/**
 * Glue between the simulation, the Phaser renderer and the DOM UI for one match.
 */
export class GameClient {
  world: World;
  selection: Selection;
  game: Phaser.Game | null = null;
  scene: GameScene | null = null;
  paused = false;
  speed = 1;
  dpr = 1;
  readonly playerFaction: number;
  private readyCbs: ((s: GameScene) => void)[] = [];
  private frameCbs: ((dt: number, s: GameScene) => void)[] = [];

  constructor(
    setup: MatchSetup,
    private parent: HTMLElement,
  ) {
    this.world = new World(setup);
    this.world.initMatch();
    this.playerFaction = setup.player;
    this.selection = new Selection(this.world);
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
      fps: { target: 60, smoothStep: true },
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
  }

  frame(dt: number, s: GameScene) {
    for (const cb of this.frameCbs) cb(dt, s);
    const c = s.camCtl;
    audio.setListener(c.x, c.y, c.viewW / c.zoom, c.viewH / c.zoom, c.zoom);
    audio.update(dt);
    if (this.world.tick % 15 === 0) this.selection.prune();
  }

  applyCameraSettings(c: CameraController) {
    c.sensitivity = settings.data.cameraSensitivity;
    c.edgeScroll = settings.data.edgeScroll;
    c.shakeEnabled = settings.data.screenShake;
  }

  startFocus(): [number, number] {
    const f = this.world.player ?? this.world.factions[0];
    const r = this.world.capitalRegion(f.id as FactionId);
    if (r) return [r.cx * TILE + 8, r.cy * TILE + 8];
    return [this.world.map.w * 8, this.world.map.h * 8];
  }

  inputHooks(scene: GameScene): InputHooks {
    return {
      order: (kind, x, y, target?: Unit) => {
        const ids = [...this.selection.units];
        if (!ids.length) return;
        if (kind === 'attack' && target) {
          this.world.orderAttack(ids, target.id);
          scene.addMarker(target.x, target.y, 'attack');
          audio.play('order_attack');
        } else {
          this.world.orderMove(ids, x, y, { attackMove: kind === 'attackMove', formation: settings.data.formation });
          scene.addMarker(x, y, kind === 'attackMove' ? 'attack' : 'move');
          audio.play(kind === 'attackMove' ? 'order_attack' : 'order_move');
        }
      },
      pickStructure: () => null,
      selected: () => {
        if (this.selection.units.size) audio.play(this.selection.units.size > 4 ? 'select_army' : 'select');
      },
      interact: () => audio.init(),
      selectSameType: (u) => {
        const v = scene.camCtl.view(0);
        const ids = this.world.units
          .filter((o) => o.alive && o.faction === u.faction && o.def.id === u.def.id && o.x > v.x0 && o.x < v.x1 && o.y > v.y0 && o.y < v.y1)
          .map((o) => o.id);
        this.selection.setUnits(ids);
      },
    };
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.scene?.input2.destroy();
    this.scene?.terrain.destroy();
    this.game?.destroy(true);
    this.game = null;
  }
}
