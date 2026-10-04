import { audio, music } from '../audio';
import { settings } from '../core/Settings';
import { NEUTRAL, TILE } from '../data/constants';
import { T } from '../sim/map/GameMap';
import { HUD } from '../ui/hud/HUD';
import { el } from '../ui/hud/dom';
import { MenuBackground } from '../ui/menus/MenuBackground';
import { credits, endScreen, howToPlay, loadingScreen, mainMenu, orientationGuard, pauseMenu, savesScreen, settingsScreen, setupScreen } from '../ui/menus/Screens';
import { loadWorld, saveWorld, type SaveFile } from '../sim/save/SaveGame';
import { saveStore, SLOT_LABEL, SLOTS, type SlotId } from './SaveStore';
import { formatTime } from '../core/math';
import { GameClient } from './GameClient';
import { playIntro } from './Intro';
import { buildMatchSetup, DEFAULT_CHOICES, type PlayerChoices } from './matchSetup';
import { Tutorial } from './Tutorial';
import type { GameScene } from '../render/GameScene';

/**
 * Top-level flow: title → setup → loading → intro → match → end screen, plus pause menu,
 * settings, dynamic music and positional ambience.
 */
export class App {
  private menuBg: MenuBackground | null = null;
  private screen: HTMLElement | null = null;
  private client: GameClient | null = null;
  private hud: HUD | null = null;
  private tutorial: Tutorial | null = null;
  private pauseEl: HTMLElement | null = null;
  private choices: PlayerChoices;
  private musicT = 0;
  private combatHeat = 0;
  private ended = false;
  private reveal = false;

  constructor(
    private gameEl: HTMLElement,
    private uiEl: HTMLElement,
  ) {
    const saved = settings.data.lastChoices as Partial<PlayerChoices> | undefined;
    this.choices = { ...DEFAULT_CHOICES, ...(saved ?? {}), tutorial: !settings.data.tutorialDone };
    // a guided first match needs you in command
    if (this.choices.tutorial) this.choices.realmAuto = false;
    document.addEventListener('pointerdown', () => audio.init(), { capture: true });
    document.addEventListener('keydown', () => audio.init(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        audio.suspend();
        if (this.client && !this.client.paused && !this.ended) this.openPause();
      } else if (!this.client || !this.client.paused) audio.resume();
    });
    orientationGuard(document.body);
  }

  start() {
    const p = new URLSearchParams(location.search);
    if (p.has('quick') || p.has('spectate')) {
      this.reveal = p.has('reveal');
      this.startMatch({ ...this.choices, tutorial: p.has('tutorial'), seed: p.has('seed') ? Number(p.get('seed')) : undefined, spectate: p.has('spectate'), era: p.get('era') === 'modern' ? 'modern' : p.get('era') === 'medieval' ? 'medieval' : this.choices.era, sandbox: p.has('sandbox') || this.choices.sandbox, realmAuto: p.has('auto') || (this.choices.realmAuto && !p.has('manual')) }, !p.has('intro'));
    } else this.showMenu();
  }

  // ------------------------------------------------------------------ menus
  private clearScreen() {
    this.screen?.remove();
    this.screen = null;
  }

  showMenu(saves?: Awaited<ReturnType<typeof saveStore.list>>) {
    this.clearScreen();
    music.setState('menu');
    if (!this.menuBg) this.menuBg = new MenuBackground(this.uiEl);
    if (!saves) {
      // list saves in the background, then offer CONTINUE / LOAD
      void saveStore.list().then((rows) => {
        if (rows.length && this.screen?.classList.contains('main') && !this.client) this.showMenu(rows);
      });
    }
    const latest = saves?.[0];
    this.screen = mainMenu(this.uiEl, {
      cont: latest ? () => this.loadSlot(latest.slot) : undefined,
      contLabel: latest ? `${latest.meta.realm.replace(/^(Kingdom|Republic) of /, '')} · ${formatTime(latest.meta.time)}` : undefined,
      load: saves?.length ? () => this.showSaves('load', () => this.showMenu(saves)) : undefined,
      play: () => this.showSetup(),
      howTo: () => {
        this.clearScreen();
        this.screen = howToPlay(this.uiEl, () => this.showMenu());
      },
      settings: () => {
        this.clearScreen();
        this.screen = settingsScreen(this.uiEl, { back: () => this.showMenu(), resetTutorial: () => (this.choices.tutorial = true) });
      },
      credits: () => {
        this.clearScreen();
        this.screen = credits(this.uiEl, () => this.showMenu());
      },
    });
  }

  private showSetup() {
    this.clearScreen();
    this.screen = setupScreen(this.uiEl, this.choices, {
      back: () => this.showMenu(),
      start: (c) => {
        this.choices = c;
        settings.set('lastChoices', { kingdomName: c.kingdomName, commanderName: c.commanderName, color: c.color, crest: c.crest, difficulty: c.difficulty, era: c.era, living: c.living, autoArmies: c.autoArmies, sandbox: c.sandbox, realmAuto: c.realmAuto, doctrine: c.doctrine });
        this.startMatch(c, false);
      },
    });
  }

  // ------------------------------------------------------------------ match
  startMatch(c: PlayerChoices, skipIntro: boolean, file?: SaveFile) {
    this.clearScreen();
    this.autosaveT = 0;
    this.menuBg?.destroy();
    this.menuBg = null;
    this.ended = false;
    const load = loadingScreen(this.uiEl);
    load.set(0.05, undefined);
    // give the loading screen a frame to paint before generating the world
    setTimeout(() => {
      let setup = buildMatchSetup(c);
      let loaded: ReturnType<typeof loadWorld> | undefined;
      if (file) {
        try {
          loaded = loadWorld(file);
          setup = loaded.setup;
          skipIntro = true;
        } catch (e) {
          console.error(e);
          load.done();
          this.showMenu();
          this.toastScreen('That save could not be loaded (it may be from an older version).');
          return;
        }
      }
      const client = new GameClient(setup, this.gameEl, loaded);
      this.client = client;
      if (this.reveal) client.world.vis.revealAll = true;
      load.set(0.25);
      client.start();
      client.onReady((scene) => {
        const tr = scene.terrain;
        const cam = file?.extra?.cam as { x: number; y: number; zoom: number } | undefined;
        if (cam) {
          scene.camCtl.cancelFly();
          scene.camCtl.x = cam.x;
          scene.camCtl.y = cam.y;
          scene.camCtl.zoom = scene.camCtl.targetZoom = cam.zoom;
        }
        let started = false;
        const begin = () => {
          if (started) return;
          started = true;
          load.done();
          this.hud = new HUD(client, this.uiEl);
          this.hud.onMenu = () => this.openPause();
          this.hud.root.style.visibility = 'hidden';
          client.onFrame((dt, s) => this.frame(dt, s));
          client.ui.on('matchEnd', (e) => this.onMatchEnd(e.winner));
          const afterIntro = () => {
            this.hud!.root.style.visibility = 'visible';
            music.setState('peace');
            const f = client.world.player;
            if (file) this.hud!.banner('GAME LOADED', `${file.meta.realm} · ${formatTime(file.meta.time)}`);
            else if (f) this.hud!.banner(f.name, `${f.setup.commanderName} ${f.setup.commanderTitle}`);
            if (c.tutorial && client.playerFaction >= 0 && !file && !client.world.setup.realmAuto) this.tutorial = new Tutorial(client, this.hud!);
            this.hud!.revealed = this.reveal;
            // a realm that runs itself is for watching
            if (client.world.setup.realmAuto || client.playerFaction < 0) this.hud!.setWatch(true);
          };
          if (skipIntro || client.playerFaction < 0) afterIntro();
          else playIntro(client, this.uiEl, afterIntro);
        };
        tr.onProgress = (d, total) => {
          load.set(0.3 + (d / total) * 0.7, d < total ? `Painting the valley… ${Math.round((d / total) * 100)}%` : undefined);
          if (d >= total * 0.35) begin();
        };
        setTimeout(begin, 5000);
      });
    }, 60);
  }

  private frame(dt: number, s: GameScene) {
    const client = this.client!;
    // autosave every few minutes of play
    if (!client.paused && !this.ended && !client.cinematic) {
      this.autosaveT += dt * client.speed;
      if (this.autosaveT > 180) {
        this.autosaveT = 0;
        void this.saveTo('auto', true);
      }
    }
    this.hud?.update(dt);
    this.tutorial?.update(dt);
    if (settings.data.debug && this.hud && !(this.hud as unknown as { debugEl: unknown }).debugEl) this.hud.toggleDebug();
    this.musicT += dt;
    if (this.musicT > 1) {
      this.musicT = 0;
      this.updateMusic();
      this.updateAmbience(s);
    }
    void client;
  }

  private heatHooked = false;
  private updateMusic() {
    const c = this.client!;
    const w = c.world;
    if (!this.heatHooked) {
      this.heatHooked = true;
      w.events.on('unitHit', (e) => {
        const u = w.unitById.get(e.id);
        if (u && (u.faction === c.playerFaction || e.fromX !== undefined)) {
          const near = c.scene ? Math.hypot(e.x - c.scene.camCtl.x, e.y - c.scene.camCtl.y) < 400 : false;
          if (u.faction === c.playerFaction || near) this.combatHeat = Math.min(30, this.combatHeat + 0.6);
        }
      });
    }
    this.combatHeat *= 0.9;
    if (this.ended || c.cinematic) return;
    const pf = c.playerFaction;
    const atWar = pf >= 0 && [0, 1, 2, 3].some((k) => k !== pf && w.factions[k]?.alive && w.diplomacy.stance(pf as never, k as never) === 'war');
    let threat = false;
    if (pf >= 0) for (const s of w.settlements) if (s.owner === pf && s.threat > 0) threat = true;
    const state = this.combatHeat > 6 || threat ? 'war' : atWar || this.combatHeat > 2 ? 'tension' : 'peace';
    music.setState(state);
  }

  private updateAmbience(s: GameScene) {
    const w = this.client!.world;
    const cam = s.camCtl;
    const m = w.map;
    const tx = Math.floor(cam.x / TILE);
    const ty = Math.floor(cam.y / TILE);
    let water = 0;
    let trees = 0;
    let n = 0;
    for (let y = ty - 8; y <= ty + 8; y += 2)
      for (let x = tx - 12; x <= tx + 12; x += 2) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const i = y * m.w + x;
        n++;
        if (m.terrain[i] === T.WATER || m.terrain[i] === T.SHALLOW) water++;
        if (m.tree[i]) trees++;
      }
    let town = 0;
    for (const st of w.settlements) {
      if (st.tier < 2 && !st.isCapital) continue;
      const d = Math.hypot(st.cx - cam.x, st.cy - cam.y);
      if (d < 260) town = Math.max(town, (1 - d / 260) * (st.owner === NEUTRAL ? 0.6 : 1) * (st.threat > 0 ? 0.3 : 1));
    }
    const close = Math.min(1, Math.max(0, (cam.zoom - 0.8) / 2));
    audio.setAmbience({
      wind: 0.25 + (1 - close) * 0.5,
      birds: close * Math.min(1, (trees / Math.max(1, n)) * 3 + 0.2) * (this.combatHeat > 4 ? 0.2 : 1),
      river: close * Math.min(1, (water / Math.max(1, n)) * 4),
      town: close * town,
      battle: Math.min(1, this.combatHeat / 10) * (0.4 + close * 0.6),
      rain: s.weather?.raining ? 0.7 : 0,
    });
  }

  private openPause() {
    const c = this.client;
    if (!c || this.pauseEl || this.ended) return;
    c.setPaused(true);
    // leaving the game (tab hidden) or pausing: keep an autosave
    if (this.client && !this.ended) void this.saveTo('auto', true);
    this.pauseEl = pauseMenu(this.uiEl, {
      resume: () => this.closePause(),
      save: () => {
        this.pauseEl!.style.display = 'none';
        this.showSaves('save', () => {
          if (this.pauseEl) this.pauseEl.style.display = '';
        });
      },
      load: () => {
        this.pauseEl!.style.display = 'none';
        this.showSaves('load', () => {
          if (this.pauseEl) this.pauseEl.style.display = '';
        });
      },
      settings: () => {
        this.pauseEl!.style.display = 'none';
        settingsScreen(this.uiEl, {
          back: () => {
            if (this.pauseEl) this.pauseEl.style.display = '';
            this.hud?.applySettings();
            c.scene?.applyQuality();
          },
        });
      },
      howTo: () => {
        this.pauseEl!.style.display = 'none';
        howToPlay(this.uiEl, () => {
          if (this.pauseEl) this.pauseEl.style.display = '';
        });
      },
      restart: () => {
        this.closePause();
        this.teardown();
        this.startMatch({ ...this.choices, seed: undefined, tutorial: false }, true);
      },
      quit: () => {
        this.closePause();
        this.teardown();
        this.showMenu();
      },
    });
  }

  private autosaveT = 0;
  private saving = false;

  /** snapshot the running match into a slot */
  private async saveTo(slot: SlotId, quiet = false): Promise<boolean> {
    const c = this.client;
    if (!c || this.saving) return false;
    this.saving = true;
    try {
      const cam = c.scene?.camCtl;
      const file = saveWorld(c.world, SLOT_LABEL[slot], cam ? { cam: { x: cam.x, y: cam.y, zoom: cam.zoom } } : undefined);
      await saveStore.write(slot, file);
      if (!quiet) this.hud?.toast(`Saved to ${SLOT_LABEL[slot]}`);
      return true;
    } catch (e) {
      console.warn('save failed', e);
      if (!quiet) this.hud?.toast('Could not save: browser storage is unavailable here', true);
      return false;
    } finally {
      this.saving = false;
    }
  }

  private async loadSlot(slot: SlotId) {
    let file: SaveFile | null = null;
    try {
      file = await saveStore.read(slot);
    } catch (e) {
      console.warn(e);
    }
    if (!file) {
      this.toastScreen('Could not read that save.');
      return;
    }
    this.pauseEl?.remove();
    this.pauseEl = null;
    if (this.client) this.teardown();
    this.clearScreen();
    this.choices = { ...this.choices, era: file.setup.era ?? this.choices.era };
    this.startMatch(this.choices, true, file);
  }

  /** the save/load slot list */
  private async showSaves(mode: 'save' | 'load', back: () => void) {
    const rows = await saveStore.list();
    const bySlot = new Map(rows.map((r) => [r.slot, r.meta]));
    const scr = savesScreen(
      this.uiEl,
      mode,
      SLOTS.map((slot) => ({ slot, label: SLOT_LABEL[slot], meta: bySlot.get(slot) ?? null })),
      {
        back,
        pick: (slot) => {
          scr.remove();
          if (mode === 'save') void this.saveTo(slot as SlotId).then(back);
          else void this.loadSlot(slot as SlotId);
        },
        remove: (slot) => {
          scr.remove();
          void saveStore.remove(slot as SlotId).then(() => this.showSaves(mode, back));
        },
      },
    );
  }

  /** a short message on top of whatever screen is showing */
  private toastScreen(text: string) {
    const t = el('div', 'screen-toast', this.uiEl, text);
    setTimeout(() => t.remove(), 4000);
  }

  private closePause() {
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.client?.setPaused(false);
  }

  private teardown() {
    this.tutorial = null;
    this.hud?.destroy();
    this.hud = null;
    this.client?.destroy();
    this.client = null;
    this.uiEl.querySelectorAll('.letterbox, .cine-text, .skip, .screen, .loading').forEach((e) => e.remove());
  }

  private onMatchEnd(winner: number) {
    const c = this.client!;
    if (this.ended) return;
    this.ended = true;
    const w = c.world;
    const pf = c.playerFaction;
    const won = winner === pf;
    const scene = c.scene!;
    music.setState(won ? 'victory' : 'defeat');
    audio.play(won ? 'victory_fanfare' : 'defeat');
    if (won) {
      // pull back over the conquered valley with celebrations
      scene.camCtl.flyTo((w.map.w * TILE) / 2, (w.map.h * TILE) / 2, scene.camCtl.fitZoom() * 1.05, 4.5);
      for (const s of w.settlements) if (s.owner === pf && Math.random() < 0.5) scene.fx.fireworks(s.cx, s.cy - 20, 2);
      this.hud?.banner('VICTORY', w.endReason === 'domination' ? 'The valley is yours' : 'No rival crown remains');
    } else {
      const f = w.factions[pf];
      const cap = f && f.capitalSettlement >= 0 ? w.settlements[f.capitalSettlement] : null;
      if (cap) scene.camCtl.flyTo(cap.cx, cap.cy, 2.2, 2);
      this.hud?.banner('YOUR KINGDOM HAS FALLEN');
    }
    setTimeout(() => {
      if (!this.client) return;
      const pfn = pf >= 0 ? pf : (winner as number);
      el('div', '', this.uiEl);
      this.screen = endScreen(this.uiEl, w, pfn, {
        rematch: () => {
          const seed = w.setup.seed;
          this.clearScreen();
          this.teardown();
          this.startMatch({ ...this.choices, seed, tutorial: false }, true);
        },
        newMatch: () => {
          this.clearScreen();
          this.teardown();
          this.showSetup();
        },
        menu: () => {
          this.clearScreen();
          this.teardown();
          this.showMenu();
        },
      });
    }, won ? 5200 : 4200);
  }
}
