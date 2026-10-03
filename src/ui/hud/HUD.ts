import { audio } from '../../audio';
import { settings } from '../../core/Settings';
import { formatTime } from '../../core/math';
import { BUILD_MENU, BUILDINGS, FORTIFY } from '../../data/buildings';
import { NEUTRAL, RES_KEYS, TILE, type FactionId } from '../../data/constants';
import { UNITS, unitClass } from '../../data/units';
import { UPGRADES } from '../../data/upgrades';
import type { GameClient } from '../../game/GameClient';
import type { Building } from '../../sim/buildings/Building';
import { TRADE_LOT, tradeRates } from '../../sim/Settlements';
import type { Notice } from '../../sim/events';
import type { Settlement } from '../../sim/territory/Settlement';
import type { Unit } from '../../sim/units/Unit';
import { crestUrl } from '../uiArt';
import { buildingPreviewUrl, costHtml, icon, installFrames, portraitUrl } from './assets';
import { clear, el, fmt, onPress, ROMAN } from './dom';
import { Minimap } from './Minimap';
import './hud.css';

interface Action {
  id: string;
  label: string;
  glyph?: string;
  img?: string;
  key?: string;
  badge?: string;
  cost?: Partial<Record<string, number>>;
  disabled?: boolean;
  active?: boolean;
  tip?: { title: string; desc?: string; extra?: string };
  press: () => void;
  long?: () => void;
}

const NOTICE_ICONS: Record<string, string> = {
  war: '⚔',
  capture: '🏰',
  lost: '🔥',
  attack: '⚔',
  build: '🔨',
  unit: '🛡',
  commander: '👑',
  event: '✦',
  economy: '⛏',
  diplomacy: '🕊',
  info: '✦',
  victory: '👑',
  defeat: '☠',
};

/**
 * The in-match HUD: kingdom crest + territory, resources with live income, system buttons,
 * notifications (tap to fly there), battle alerts, minimap, army banners, a contextual selection
 * panel and a thumb-sized action bar, build/recruit/trade sheets, tooltips and modals.
 */
export class HUD {
  root: HTMLDivElement;
  private resEls: Record<string, { val: HTMLElement; inc: HTMLElement; last: number }> = {};
  private popEl!: HTMLElement;
  private terrEl!: HTMLElement;
  private noticesEl!: HTMLElement;
  private selEl!: HTMLElement;
  private actEl!: HTMLElement;
  private armiesEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private tooltipEl!: HTMLElement;
  private standEls: { id: number; it: HTMLElement; val: HTMLElement; inc: HTMLElement }[] = [];
  private sheetEl: HTMLElement | null = null;
  private fpsEl!: HTMLElement;
  private debugEl: HTMLElement | null = null;
  private speedBtn!: HTMLButtonElement;
  minimap!: Minimap;
  private t = 0;
  private selSig = '';
  private actSig = '';
  private visibleNotices: HTMLElement[] = [];
  private noticeQueue: Notice[] = [];
  private lastNoticeText = new Map<string, number>();
  private frames = 0;
  private fpsT = 0;
  private mode = 'default';
  private buildCtx: { region: number; plot: number } | null = null;
  onMenu?: () => void;
  objective: { title: string; text: string; done: boolean } | null = null;

  constructor(
    private client: GameClient,
    parent: HTMLElement,
  ) {
    installFrames();
    this.root = el('div', '', parent) as HTMLDivElement;
    this.root.id = 'hud';
    this.applySettings();
    this.buildTop();
    this.noticesEl = el('div', 'hud-notices', this.root);
    this.objectiveEl = el('div', 'hud-objective panel', this.root);
    this.timerEl = el('div', 'hud-timer panel', this.root);
    this.buildMinimap();
    this.armiesEl = el('div', 'hud-armies', this.root);
    this.selEl = el('div', 'hud-sel panel', this.root);
    this.actEl = el('div', 'hud-actions', this.root);
    this.tooltipEl = el('div', 'tooltip panel', document.body);
    this.tooltipEl.style.display = 'none';
    this.fpsEl = el('div', 'fps', this.root);
    const w = client.world;
    w.events.on('notice', (n) => this.onNotice(n));
    w.events.on('ceasefireOffer', (o) => {
      if (w.setup.player >= 0) this.ceasefireModal(o.id, o.from, o.against, o.duration);
    });
    client.ui.on('toast', (t) => this.toast(t.text, t.error));
    client.ui.on('selection', () => {
      this.selSig = '';
      this.actSig = '';
      this.closeSheet();
    });
    client.ui.on('openBuild', (e) => this.openBuildSheet(e.region, e.plot));
    client.ui.on('mode', (e) => {
      this.mode = e.mode;
      this.actSig = '';
    });
    client.ui.on('armies', () => this.renderArmies());
    settings.onChange(() => this.applySettings());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.keyUp);
    this.renderArmies();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.keyUp);
    this.root.remove();
    this.tooltipEl.remove();
  }

  applySettings() {
    const d = settings.data;
    document.documentElement.style.setProperty('--ui-scale', String(d.uiScale));
    this.root.classList.toggle('large-buttons', d.largeButtons);
  }

  // ------------------------------------------------------------------ top bar
  private buildTop() {
    const c = this.client;
    const f = c.world.player ?? c.world.factions[0];
    const top = el('div', 'hud-top', this.root);
    if (c.playerFaction < 0) this.buildStandings(top);
    else {
      const k = el('div', 'hud-kingdom panel pe', top);
      const img = el('img', '', k) as HTMLImageElement;
      img.src = crestUrl(f.setup.crest, f.color);
      const txt = el('div', 'ktext', k);
      el('div', 'kname', txt, f.name.replace(/^Kingdom of /, ''));
      this.terrEl = el('div', 'kterr', txt);
      onPress(k, () => c.jumpCapital(), { sound: () => audio.play('ui_click') });
      k.title = 'Your kingdom — tap to view the capital';
      const resWrap = el('div', 'hud-res', top);
      const bar = el('div', 'resbar panel pe', resWrap);
      for (const r of RES_KEYS) {
        const it = el('div', 'res-item', bar);
        const ic = el('img', 'icon', it) as HTMLImageElement;
        ic.src = icon(r);
        const val = el('span', 'val', it);
        const inc = el('span', 'inc', it);
        this.resEls[r] = { val, inc, last: 0 };
        this.tip(it, () => ({ title: r[0].toUpperCase() + r.slice(1), desc: RES_DESC[r], extra: `Income ${Math.round(c.world.player?.income[r] ?? 0)}/min` }));
      }
      const pop = el('div', 'res-item', bar);
      (el('img', 'icon', pop) as HTMLImageElement).src = icon('pop');
      this.popEl = el('span', 'val', pop);
      this.tip(pop, () => ({ title: 'Population', desc: 'Soldiers in your service / capacity. Raise capacity with houses and settlements.' }));
    }
    const sys = el('div', 'hud-sys', top);
    if (settings.data.gameSpeedControls && !matchMedia('(pointer: coarse)').matches) {
      this.speedBtn = el('button', 'hud-btn', sys, '1×') as HTMLButtonElement;
      onPress(this.speedBtn, () => {
        const speeds = [1, 1.5, 2];
        c.speed = speeds[(speeds.indexOf(c.speed) + 1) % speeds.length];
        this.speedBtn.textContent = `${c.speed}×`;
      }, { sound: () => audio.play('ui_click') });
      this.tip(this.speedBtn, () => ({ title: 'Game speed', desc: '1× · 1.5× · 2×' }));
    }
    const pause = el('button', 'hud-btn', sys, '❚❚') as HTMLButtonElement;
    onPress(pause, () => this.onMenu?.(), { sound: () => audio.play('ui_open') });
    this.tip(pause, () => ({ title: 'Pause & menu', desc: 'Esc' }));
  }

  private buildMinimap() {
    const wrap = el('div', 'hud-mini', this.root);
    const zr = el('div', 'zoom-row', wrap);
    const mk = (label: string, p: 'strategic' | 'normal' | 'close', tip: string) => {
      const b = el('button', 'hud-btn', zr, label) as HTMLButtonElement;
      onPress(b, () => this.client.scene?.camCtl.setZoomPreset(p), { sound: () => audio.play('ui_click') });
      this.tip(b, () => ({ title: tip }));
      return b;
    };
    mk('MAP', 'strategic', 'Strategic view');
    mk('MID', 'normal', 'Normal view');
    mk('NEAR', 'close', 'Close view');
    const alertBtn = el('button', 'hud-btn', zr, '!') as HTMLButtonElement;
    onPress(alertBtn, () => this.client.jumpToAlert(), { sound: () => audio.play('ui_click') });
    this.tip(alertBtn, () => ({ title: 'Last alert', desc: 'Space' }));
    const mm = el('div', 'minimap panel dark', wrap);
    this.minimap = new Minimap(this.client, mm);
  }

  // ------------------------------------------------------------------ frame update
  update(dt: number) {
    this.t += dt;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fpsEl.textContent = settings.data.showFps ? `${Math.round(this.frames / this.fpsT)} fps` : '';
      this.frames = 0;
      this.fpsT = 0;
    }
    this.minimap.update(dt);
    if ((this.t * 6) % 1 < dt * 6) this.refreshTop();
    if ((this.t * 4) % 1 < dt * 4) {
      this.refreshSelection();
      this.refreshActions();
      this.refreshTimers();
      this.refreshArmyCounts();
      if (this.debugEl) this.refreshDebug();
      if (this.sheetEl && this.buildCtx) this.refreshSheetAffordability();
    }
  }

  /** spectating: no economy of our own, so the bar shows every kingdom's standing instead */
  private buildStandings(top: HTMLElement) {
    const w = this.client.world;
    const k = el('div', 'hud-kingdom panel pe', top);
    const txt = el('div', 'ktext', k);
    el('div', 'kname', txt, 'Spectating');
    el('div', 'kterr', txt, 'Four AI kingdoms');
    const wrap = el('div', 'hud-res', top);
    const bar = el('div', 'resbar panel pe standings', wrap);
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL) continue;
      const it = el('div', 'res-item', bar);
      (el('img', 'icon crest', it) as HTMLImageElement).src = crestUrl(f.setup.crest, f.color);
      const val = el('span', 'val', it);
      const inc = el('span', 'inc', it);
      inc.style.color = f.color.light;
      this.standEls.push({ id: f.id, it, val, inc });
      this.tip(it, () => ({ title: f.name, desc: f.alive ? `${f.regionsOwned} regions · ${Math.round(f.pop)} soldiers` : 'Eliminated' }));
    }
  }

  private refreshStandings() {
    const w = this.client.world;
    for (const e of this.standEls) {
      const f = w.factions[e.id];
      const v = `${Math.round(f.territoryShare * 100)}%`;
      if (e.val.textContent !== v) e.val.textContent = v;
      const a = f.alive ? `⚔${Math.round(f.pop)}` : '✝';
      if (e.inc.textContent !== a) e.inc.textContent = a;
      e.it.classList.toggle('dead', !f.alive);
    }
  }

  private refreshTop() {
    if (this.standEls.length) return this.refreshStandings();
    const f = this.client.world.player;
    if (!f) return;
    for (const r of RES_KEYS) {
      const e = this.resEls[r];
      const v = Math.floor(f.res[r]);
      const txt = fmt(v);
      if (e.val.textContent !== txt) {
        e.val.textContent = txt;
        if (v > e.last + 4) {
          e.val.classList.add('bump');
          setTimeout(() => e.val.classList.remove('bump'), 140);
        }
        e.val.classList.toggle('low', v < 30);
      }
      e.last = v;
      const inc = Math.round(f.income[r]);
      const itxt = `${inc >= 0 ? '+' : ''}${inc}/m`;
      if (e.inc.textContent !== itxt) e.inc.textContent = itxt;
    }
    const ptxt = `${Math.round(f.pop)}/${f.popCap}`;
    if (this.popEl.textContent !== ptxt) this.popEl.textContent = ptxt;
    this.popEl.classList.toggle('low', f.pop >= f.popCap);
    const terr = `Territory <b>${Math.round(f.territoryShare * 100)}%</b> · ${f.regionsOwned} region${f.regionsOwned === 1 ? '' : 's'}`;
    if (this.terrEl.innerHTML !== terr) this.terrEl.innerHTML = terr;
  }

  private refreshTimers() {
    const w = this.client.world;
    const parts: string[] = [];
    const d = w.victory.domination;
    if (d) {
      const f = w.factions[d.faction];
      parts.push(`<div style="color:${f.color.light}">DOMINATION · ${f.name.replace(/^Kingdom of /, '')}</div><div style="font-size:1.4em">${formatTime(90 - d.t)}</div>`);
    }
    const p = w.player;
    if (p && p.critical > 0) parts.push(`<div style="color:#ff9a8a">CAPITAL LOST — new capital in</div><div style="font-size:1.4em">${formatTime(p.critical)}</div>`);
    if (p && p.commanderRespawn > 0) parts.push(`<div style="color:#d8c890;font-size:0.85em">👑 ${p.setup.commanderName} returns in ${Math.ceil(p.commanderRespawn)}s</div>`);
    parts.push(`<div style="color:#a89a80;font-size:0.8em">${formatTime(w.time)}</div>`);
    const html = parts.join('');
    if (this.timerEl.innerHTML !== html) this.timerEl.innerHTML = html;
    this.timerEl.classList.toggle('show', true);
  }

  // ------------------------------------------------------------------ notices
  private onNotice(n: Notice) {
    const w = this.client.world;
    const pf = this.client.playerFaction as FactionId;
    const involved = pf < 0 || (n.factions?.includes(pf) ?? false);
    const show = involved ? !n.quiet : n.world && (n.priority ?? 0) >= 1;
    if (!show) return;
    // de-duplicate repeated messages
    const last = this.lastNoticeText.get(n.text) ?? -99;
    if (w.time - last < 8) return;
    this.lastNoticeText.set(n.text, w.time);
    if (n.alarm) audio.play('horn_warning');
    else if (n.kind === 'war' && involved) audio.play('battle_cry', { volume: 0.6 });
    else audio.play('notification', { volume: 0.6 });
    if ((n.priority ?? 0) >= 2 && involved && (n.kind === 'capture' || n.kind === 'war' || n.kind === 'lost' || n.kind === 'defeat')) this.banner(n.text.replace(/^[^A-Z0-9]+/, ''), n.sub);
    this.noticeQueue.push(n);
    this.pumpNotices();
  }

  private pumpNotices() {
    while (this.noticeQueue.length && this.visibleNotices.length < 3) {
      const n = this.noticeQueue.shift()!;
      const e = el('div', `notice panel dark ${n.alarm ? 'alarm' : ''} ${n.kind}`, this.noticesEl);
      const ic = NOTICE_ICONS[n.kind] ?? '';
      const text = /^[☀-⟿\u{1f300}-\u{1faff}]/u.test(n.text) ? n.text : `${ic} ${n.text}`;
      el('div', 'ntext', e, text);
      if (n.sub) el('div', 'nsub', e, n.sub);
      if (n.x !== undefined && n.y !== undefined) {
        const x = n.x;
        const y = n.y;
        onPress(e, () => this.client.focus(x, y), { sound: () => audio.play('ui_click') });
      }
      this.visibleNotices.push(e);
      const life = n.alarm ? 7000 : (n.priority ?? 0) >= 2 ? 6000 : 4500;
      setTimeout(() => {
        e.classList.add('fade');
        setTimeout(() => {
          e.remove();
          this.visibleNotices = this.visibleNotices.filter((v) => v !== e);
          this.pumpNotices();
        }, 400);
      }, life);
    }
  }

  banner(text: string, sub?: string) {
    const b = el('div', 'big-banner', this.root);
    el('div', 'bt', b, text);
    if (sub) el('div', 'bs', b, sub);
    setTimeout(() => b.remove(), 3300);
  }

  toast(text: string, error = false) {
    this.root.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = el('div', `toast panel dark ${error ? 'error' : ''}`, this.root, text);
    setTimeout(() => t.remove(), 1800);
  }

  setObjective(o: { title: string; text: string; done: boolean } | null) {
    this.objective = o;
    if (!o) {
      this.objectiveEl.classList.remove('show');
      return;
    }
    this.objectiveEl.innerHTML = `<div class="otitle">${o.title}</div><div class="otext">${o.text}</div>`;
    this.objectiveEl.classList.add('show');
    this.objectiveEl.classList.toggle('done', o.done);
  }

  // ------------------------------------------------------------------ armies
  renderArmies() {
    clear(this.armiesEl);
    const sel = this.client.selection;
    const pf = this.client.world.player;
    for (let n = 1; n <= 9; n++) {
      const ids = sel.armies.get(n);
      if (!ids || !ids.length) continue;
      const chip = el('div', 'army-chip', this.armiesEl);
      chip.dataset.army = String(n);
      const st = el('div', 'stripe', chip);
      st.style.background = pf?.color.main ?? '#888';
      el('div', 'an', chip, ROMAN[n]);
      el('div', 'ac', chip, String(ids.length));
      let lastTap = 0;
      onPress(
        chip,
        () => {
          const now = performance.now();
          if (now - lastTap < 350) this.focusArmy(n);
          lastTap = now;
          sel.selectArmy(n);
          audio.play('select_army');
        },
        {
          long: () => {
            // long-press: reassign current selection to this banner
            if (sel.units.size) {
              sel.assignArmy(n);
              this.toast(`Army ${ROMAN[n]} reformed`);
              this.renderArmies();
            }
          },
        },
      );
      this.tip(chip, () => ({ title: `Army ${ROMAN[n]}`, desc: `Tap to select · double-tap to view · hold to reassign · keys ${n} / Ctrl+${n}` }));
    }
  }

  private refreshArmyCounts() {
    const sel = this.client.selection;
    let changed = false;
    this.armiesEl.querySelectorAll<HTMLElement>('.army-chip').forEach((chip) => {
      const n = Number(chip.dataset.army);
      const ids = sel.armies.get(n);
      if (!ids) {
        changed = true;
        return;
      }
      const c = chip.querySelector('.ac')!;
      if (c.textContent !== String(ids.length)) c.textContent = String(ids.length);
      const allSel = ids.length > 0 && ids.every((id) => sel.units.has(id)) && sel.units.size === ids.length;
      chip.classList.toggle('sel', allSel);
    });
    const count = this.armiesEl.children.length;
    if (changed || count !== sel.armies.size) this.renderArmies();
  }

  private focusArmy(n: number) {
    const ids = this.client.selection.armies.get(n);
    if (!ids) return;
    const us = ids.map((id) => this.client.world.unitById.get(id)).filter((u): u is Unit => !!u);
    if (!us.length) return;
    const x = us.reduce((a, u) => a + u.x, 0) / us.length;
    const y = us.reduce((a, u) => a + u.y, 0) / us.length;
    this.client.focus(x, y);
  }

  // ------------------------------------------------------------------ selection panel
  private selected(): { kind: 'units'; units: Unit[] } | { kind: 'building'; b: Building } | { kind: 'region'; s: Settlement } | null {
    const sel = this.client.selection;
    const w = this.client.world;
    if (sel.units.size) {
      const units = sel.unitList();
      if (units.length) return { kind: 'units', units };
    }
    if (sel.building) {
      const b = w.buildingById.get(sel.building);
      if (b && !b.destroyed) return { kind: 'building', b };
    }
    if (sel.region >= 0) return { kind: 'region', s: w.settlements[sel.region] };
    return null;
  }

  private refreshSelection() {
    const s = this.selected();
    const w = this.client.world;
    if (!s) {
      if (this.selSig !== 'none') {
        this.selSig = 'none';
        this.selEl.classList.remove('show');
      }
      return;
    }
    this.selEl.classList.add('show');
    let sig = '';
    if (s.kind === 'units') sig = 'u:' + s.units.map((u) => `${u.id}:${Math.round((u.hp / u.maxHp) * 20)}`).join(',');
    else if (s.kind === 'building') sig = `b:${s.b.id}:${s.b.faction}:${Math.round(s.b.hp)}:${Math.round(s.b.progress * 50)}:${s.b.queue.map((q) => q.type + Math.round((q.t / q.total) * 20)).join(',')}:${s.b.research?.id ?? ''}${Math.round((s.b.research?.t ?? 0) / 2)}:${w.settlements[s.b.settlementId].tier}:${Math.round(w.settlements[s.b.settlementId].upgrading?.t ?? 0)}`;
    else sig = `r:${s.s.id}:${s.s.owner}:${s.s.tier}:${Math.round(s.s.capProgress * 20)}:${Math.round(s.s.upgrading?.t ?? 0)}`;
    if (sig === this.selSig) return;
    this.selSig = sig;
    clear(this.selEl);
    if (s.kind === 'units') this.renderUnits(s.units);
    else if (s.kind === 'building') this.renderBuilding(s.b);
    else this.renderSettlement(s.s, null);
  }

  private colorOf(f: number) {
    const w = this.client.world;
    return w.factions[f]?.color ?? w.factions[0].color;
  }

  private renderUnits(units: Unit[]) {
    const p = this.selEl;
    if (units.length === 1) {
      const u = units[0];
      const head = el('div', 'sel-head', p);
      const img = el('img', 'portrait', head) as HTMLImageElement;
      img.src = portraitUrl(u.def.id, this.colorOf(u.faction));
      const t = el('div', '', head);
      const f = this.client.world.factions[u.faction];
      const name = u.def.special === 'commander' ? `${f.setup.commanderName} ${f.setup.commanderTitle}` : u.def.name;
      el('div', 'sel-title', t, name);
      el('div', 'sel-sub', t, `${u.def.role}${u.faction !== this.client.playerFaction ? ' · ' + f.name : ''}`);
      const hp = el('div', 'hpbar', t);
      (el('i', '', hp) as HTMLElement).style.width = `${(u.hp / u.maxHp) * 100}%`;
      const atk = u.def.attack + u.atkBonus;
      const st = el('div', 'sel-stats', p);
      st.innerHTML = `<span>❤ ${Math.ceil(u.hp)}/${Math.round(u.maxHp)}</span><span>⚔ ${atk}${u.def.projectile ? ' · range ' + Math.round(u.range / TILE) : ''}</span><span>🛡 ${u.def.armor.melee + u.armorBonus.melee}/${u.def.armor.pierce + u.armorBonus.pierce}</span><span>Morale ${Math.round(u.morale)}</span>${u.kills ? `<span>☠ ${u.kills}</span>` : ''}${u.army ? `<span>Army ${ROMAN[u.army]}</span>` : ''}`;
      this.tip(img, () => ({ title: u.def.name, desc: u.def.desc }));
      return;
    }
    const head = el('div', 'sel-head', p);
    const t = el('div', '', head);
    const power = units.reduce((a, u) => a + u.def.power, 0);
    el('div', 'sel-title', t, `${units.length} soldiers`);
    const hp = units.reduce((a, u) => a + u.hp, 0) / units.reduce((a, u) => a + u.maxHp, 0);
    el('div', 'sel-sub', t, `Strength ${Math.round(power)} · ${Math.round(hp * 100)}% health · ${this.client.formation} formation`);
    const chips = el('div', 'chips', p);
    const byType = new Map<string, Unit[]>();
    for (const u of units) {
      let a = byType.get(u.def.id);
      if (!a) byType.set(u.def.id, (a = []));
      a.push(u);
    }
    const order = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [type, list] of order) {
      const c = el('div', 'uchip', chips);
      (el('img', '', c) as HTMLImageElement).src = portraitUrl(type, this.colorOf(list[0].faction));
      el('b', '', c, String(list.length));
      const avg = list.reduce((a, u) => a + u.hp / u.maxHp, 0) / list.length;
      (el('i', '', c) as HTMLElement).style.width = `${avg * 100}%`;
      onPress(c, () => this.client.selection.setUnits(list.map((u) => u.id)), { sound: () => audio.play('select') });
      this.tip(c, () => ({ title: `${list.length} ${list.length > 1 ? UNITS[type].plural : UNITS[type].name}`, desc: `${UNITS[type].role}. Tap to select only these.` }));
    }
  }

  private renderBuilding(b: Building) {
    const w = this.client.world;
    const p = this.selEl;
    const s = w.settlements[b.settlementId];
    if (b.def.category === 'core' || b.def.category === 'landmark') {
      this.renderSettlement(s, b);
      return;
    }
    const head = el('div', 'sel-head', p);
    const img = el('img', 'portrait', head) as HTMLImageElement;
    img.src = buildingPreviewUrl(b.def.id, b.faction === NEUTRAL ? null : this.colorOf(b.faction));
    const t = el('div', '', head);
    el('div', 'sel-title', t, b.def.name);
    const owner = b.faction === NEUTRAL ? 'Free Folk' : w.factions[b.faction].name;
    let status = `${s.name} · ${owner}`;
    if (!b.built) status = `Under construction ${Math.round(b.progress * 100)}% · ${s.name}`;
    el('div', 'sel-sub', t, status);
    const hp = el('div', `hpbar ${b.built ? '' : 'prog'}`, t);
    (el('i', '', hp) as HTMLElement).style.width = `${(b.built ? b.hp / b.maxHp : b.progress) * 100}%`;
    const st = el('div', 'sel-stats', p);
    const bits: string[] = [`❤ ${Math.ceil(b.hp)}/${Math.round(b.maxHp)}`];
    if (b.def.produces && b.built) {
      const k = b.staffed * b.efficiency;
      const [res, v] = b.def.id === 'mine' ? [b.depositKind ?? 'gold', b.depositKind === 'stone' ? 20 : 26] : Object.entries(b.def.produces)[0];
      bits.push(`<img class="icon" style="width:12px;height:12px" src="${icon(res as string)}"> +${Math.round((v as number) * k)}/min`);
      if (b.staffed < 1) bits.push(b.staffed === 0 ? '<span style="color:#ff9a8a">workers sheltering</span>' : 'short-handed');
      if (b.efficiency < 0.6 && b.def.id === 'lumber_camp') bits.push('<span style="color:#e8c070">forest thinning</span>');
    }
    if (b.def.popCap && b.built) bits.push(`+${b.def.popCap} population`);
    if (b.def.defence && b.built) bits.push(`⚔ ${b.def.defence.attack} arrows`);
    if (b.research) bits.push(`Researching ${UPGRADES[b.research.id].name} ${Math.round((b.research.t / b.research.total) * 100)}%`);
    st.innerHTML = bits.map((x) => `<span>${x}</span>`).join('');
    if (b.queue.length) this.renderQueue(b, p);
    if (b.def.id === 'merc_camp') {
      const camp = w.events2 && (w.events2 as unknown as { camps: { buildingId: number; expires: number }[] }).camps.find((c) => c.buildingId === b.id);
      if (camp) el('div', 'sel-stats', p, `<span>Leaves in ${Math.ceil(camp.expires - w.time)}s · bring troops close to hire</span>`);
    }
  }

  private renderQueue(b: Building, p: HTMLElement) {
    const q = el('div', 'queue', p);
    b.queue.forEach((job, i) => {
      const c = el('div', 'q', q);
      (el('img', '', c) as HTMLImageElement).src = portraitUrl(job.type, this.colorOf(b.faction));
      if (i === 0) (el('i', '', c) as HTMLElement).style.width = `${(job.t / job.total) * 100}%`;
      if (b.faction === this.client.playerFaction) {
        onPress(c, () => this.client.cmdCancel(b.id, i));
        this.tip(c, () => ({ title: UNITS[job.type].name, desc: 'Tap to cancel (full refund)' }));
      }
    });
  }

  private renderSettlement(s: Settlement, core: Building | null) {
    const w = this.client.world;
    const p = this.selEl;
    const own = s.owner === this.client.playerFaction;
    const head = el('div', 'sel-head', p);
    const img = el('img', 'portrait', head) as HTMLImageElement;
    const coreB = core ?? w.buildingById.get(s.coreId) ?? null;
    if (coreB) img.src = buildingPreviewUrl(coreB.def.id, s.owner === NEUTRAL ? null : this.colorOf(s.owner));
    const t = el('div', '', head);
    el('div', 'sel-title', t, s.name);
    const owner = s.owner === NEUTRAL ? 'Unclaimed' : w.factions[s.owner].name;
    el('div', 'sel-sub', t, `${s.tierName} · ${owner}`);
    if (coreB && coreB.def.category !== 'landmark') {
      const hp = el('div', 'hpbar', t);
      (el('i', '', hp) as HTMLElement).style.width = `${(coreB.hp / coreB.maxHp) * 100}%`;
    }
    const st = el('div', 'sel-stats', p);
    const bits: string[] = [];
    if (s.tax.gold) bits.push(`<img class="icon" style="width:12px;height:12px" src="${icon('gold')}"> +${s.tax.gold}`);
    if (s.tax.food) bits.push(`<img class="icon" style="width:12px;height:12px" src="${icon('food')}"> +${s.tax.food}`);
    if (s.popCap) bits.push(`+${s.popCap} pop`);
    const used = s.plots.slice(0, s.unlockedPlots).filter((pl) => pl.buildingId).length;
    if (own) bits.push(`Plots ${used}/${s.unlockedPlots}`);
    if (s.region.features.length) bits.push(s.region.features.join(' · '));
    if (s.upgrading) bits.push(`Upgrading ${Math.round((s.upgrading.t / s.upgrading.total) * 100)}%`);
    if (s.fortifying) bits.push(`Fortifying ${Math.round((s.fortifying.t / s.fortifying.total) * 100)}%`);
    if (s.capProgress > 0 && s.capFaction >= 0) bits.push(`<span style="color:${w.factions[s.capFaction].color.light}">Capture ${Math.round(s.capProgress * 100)}%</span>`);
    if (s.needsBreach) bits.push('<span style="color:#ff9a8a">Breach the keep to capture</span>');
    if (!own && s.owner === NEUTRAL && s.region.def.garrison) bits.push(`Garrison: ${s.region.def.garrison.map(([u, n]) => `${n} ${UNITS[u].plural}`).join(', ')}`);
    st.innerHTML = bits.map((x) => `<span>${x}</span>`).join('');
    if (coreB && coreB.queue.length) this.renderQueue(coreB, p);
    if (s.region.def.lore && !own) el('div', 'sel-sub', p, `<i>${s.region.def.lore}</i>`);
  }

  // ------------------------------------------------------------------ actions
  private actionsFor(): Action[] {
    const c = this.client;
    const w = c.world;
    const sel = this.selected();
    const f = w.player;
    const acts: Action[] = [];
    if (!f) return acts;
    const res = f.res as unknown as Record<string, number>;
    if (!sel) {
      acts.push({ id: 'all', label: 'ARMY', glyph: '⚔', key: 'Q', press: () => c.selectAllMilitary(), tip: { title: 'Select all soldiers', desc: 'Q' } });
      acts.push({ id: 'boxsel', label: 'SELECT', glyph: '⬚', active: this.mode === 'select', press: () => c.setMode(this.mode === 'select' ? 'default' : 'select'), tip: { title: 'Box select', desc: 'Then drag over your troops. (Or press and hold, then drag.)' } });
      acts.push({ id: 'idle', label: 'IDLE', glyph: '☾', key: '.', press: () => c.selectIdle(), tip: { title: 'Find idle troops', desc: '.' } });
      acts.push({ id: 'capital', label: 'CAPITAL', glyph: '♛', key: 'H', press: () => c.jumpCapital(), tip: { title: 'View capital', desc: 'Home' } });
      return acts;
    }
    if (sel.kind === 'units') {
      const own = sel.units.filter((u) => u.faction === c.playerFaction);
      if (!own.length) return acts;
      acts.push({ id: 'attack', label: 'ATTACK', glyph: '⚔', key: 'A', active: this.mode === 'attack', press: () => c.setMode(this.mode === 'attack' ? 'default' : 'attack'), tip: { title: 'Attack-move', desc: 'Advance and fight anything on the way. Tap the ground or an enemy. (A)' } });
      acts.push({ id: 'move', label: 'MOVE', glyph: '➜', key: 'M', active: this.mode === 'move', press: () => c.setMode(this.mode === 'move' ? 'default' : 'move'), tip: { title: 'Move / retreat', desc: 'March without stopping to fight. (M)' } });
      acts.push({ id: 'hold', label: 'DEFEND', glyph: '⛨', key: 'G', press: () => c.cmdHold(), tip: { title: 'Defend position', desc: 'Hold this ground and fight only what comes close. (G)' } });
      const fi = { line: '═', wedge: '▲', defensive: '◎', loose: '⁘' }[c.formation];
      acts.push({ id: 'form', label: c.formation.toUpperCase(), glyph: fi, key: 'F', press: () => c.cycleFormation(), tip: { title: 'Formation', desc: 'Line · Wedge · Defensive · Loose (F)' } });
      const inArmy = own.every((u) => u.army && u.army === own[0].army);
      acts.push({
        id: 'army',
        label: inArmy ? `ARMY ${ROMAN[own[0].army]}` : 'GROUP',
        glyph: '⚑',
        key: 'Ctrl+#',
        disabled: inArmy,
        press: () => {
          if (inArmy) return;
          const n = c.createArmy();
          if (n) this.toast(`Army ${ROMAN[n]} formed (${own.length})`);
        },
        tip: { title: 'Create army banner', desc: 'Groups the selection under a banner for one-tap selection. (Ctrl+1..9)' },
      });
      acts.push({ id: 'stop', label: 'STOP', glyph: '✋', key: 'S', press: () => c.cmdStop(), tip: { title: 'Stop', desc: 'S' } });
      acts.push({ id: 'desel', label: 'CLEAR', glyph: '✕', key: 'Esc', press: () => c.selection.clear(), tip: { title: 'Deselect', desc: 'Esc' } });
      return acts;
    }
    if (sel.kind === 'building') {
      const b = sel.b;
      const s = w.settlements[b.settlementId];
      if (b.def.id === 'merc_camp') return this.mercActions(b);
      if (b.faction !== c.playerFaction) return acts;
      if (b.def.category === 'core' || b.def.category === 'landmark') return this.settlementActions(s, b);
      if (b.built) {
        // recruit
        for (const type of w.settlementSys.allTrainableAt(b).slice(0, 6)) acts.push(this.recruitAction(b, type, res));
        // research
        if (b.def.researches) {
          for (const id of b.def.researches) {
            if (f.upgrades.has(id)) continue;
            const up = UPGRADES[id];
            const chk = w.settlementSys.canResearch(c.playerFaction as FactionId, b.id, id);
            acts.push({
              id: 'res_' + id,
              label: up.name.toUpperCase(),
              glyph: '✦',
              cost: up.cost,
              disabled: !chk.ok,
              active: b.research?.id === id,
              press: () => c.cmdResearch(b.id, id),
              tip: { title: up.name, desc: up.desc, extra: chk.ok ? costHtml(up.cost, res) + ` · ${up.time}s` : chk.reason },
            });
          }
        }
        if (b.def.id === 'market') acts.push({ id: 'trade', label: 'TRADE', glyph: '⚖', press: () => this.openTradeSheet(), tip: { title: 'Trade goods', desc: 'Buy and sell food, wood and stone for gold.' } });
        if (w.settlementSys.allTrainableAt(b).length) acts.push({ id: 'rally', label: 'RALLY', glyph: '⚑', active: this.mode === 'rally', press: () => c.setMode(this.mode === 'rally' ? 'default' : 'rally'), tip: { title: 'Set rally point', desc: 'New recruits gather there. (Right-click on desktop)' } });
      }
      acts.push({ id: 'demolish', label: 'DEMOLISH', glyph: '⚒', long: () => c.cmdDemolish(b.id), press: () => this.toast('Hold to demolish'), tip: { title: 'Demolish', desc: 'Press and hold to tear down and free the plot.' } });
      return acts;
    }
    if (sel.kind === 'region') {
      if (sel.s.owner !== c.playerFaction) return acts;
      return this.settlementActions(sel.s, w.buildingById.get(sel.s.coreId) ?? null);
    }
    return acts;
  }

  private recruitAction(b: Building, type: string, res: Record<string, number>): Action {
    const c = this.client;
    const def = UNITS[type];
    const chk = c.world.settlementSys.canRecruit(c.playerFaction as FactionId, b.id, type);
    const locked = chk.reason?.startsWith('Requires');
    return {
      id: 'rec_' + type,
      label: def.name.toUpperCase().replace('VETERAN SWORDSMAN', 'VETERAN').replace('LIGHT CAVALRY', 'LT CAVALRY'),
      img: portraitUrl(type, this.colorOf(c.playerFaction)),
      cost: def.cost,
      disabled: !chk.ok,
      badge: b.queue.filter((q) => q.type === type).length ? String(b.queue.filter((q) => q.type === type).length) : undefined,
      press: () => {
        if (locked) return c.toast(chk.reason!, true);
        c.cmdRecruit(b.id, type);
      },
      tip: { title: `${def.name} — ${def.role}`, desc: def.desc, extra: (chk.ok || chk.reason === 'Not enough resources' ? costHtml(def.cost, res) + ` · ${def.trainTime}s · ${def.pop} pop` : chk.reason) + (chk.ok || chk.reason === 'Not enough resources' ? '' : '') },
    };
  }

  private settlementActions(s: Settlement, core: Building | null): Action[] {
    const c = this.client;
    const w = c.world;
    const f = w.player!;
    const res = f.res as unknown as Record<string, number>;
    const acts: Action[] = [];
    if (core && core.def.category === 'core' && core.active) {
      for (const type of w.settlementSys.allTrainableAt(core)) acts.push(this.recruitAction(core, type, res));
    }
    const free = s.plots.slice(0, s.unlockedPlots).filter((p) => !p.buildingId).length;
    acts.push({ id: 'build', label: 'BUILD', glyph: '⌂', key: 'B', badge: free ? String(free) : undefined, disabled: !free, press: () => this.openBuildSheet(s.id, -1), tip: { title: 'Build', desc: free ? `${free} free plot${free > 1 ? 's' : ''}. Tap a glowing plot or choose here. (B)` : 'No free plots — upgrade to unlock more.' } });
    const ucost = w.settlementSys.upgradeCost(s);
    if (ucost) {
      const chk = w.settlementSys.canUpgrade(c.playerFaction as FactionId, s.id);
      const next = s.isCapital ? 'Royal Capital' : s.tier === 2 ? 'Town' : 'Castle Town';
      acts.push({
        id: 'upgrade',
        label: 'UPGRADE',
        glyph: '⇧',
        cost: ucost,
        disabled: !chk.ok,
        active: !!s.upgrading,
        press: () => c.cmdUpgrade(s.id),
        tip: { title: `Upgrade to ${next}`, desc: UPGRADE_DESC[next] ?? '', extra: chk.ok ? costHtml(ucost, res) : chk.reason },
      });
    }
    const fz = FORTIFY.find((x) => x.level === s.fortify + 1);
    if (fz && (s.tier >= 2 || s.isCapital)) {
      const chk = w.settlementSys.canFortify(c.playerFaction as FactionId, s.id);
      acts.push({
        id: 'fortify',
        label: fz.level === 1 ? 'PALISADE' : 'WALLS',
        glyph: '▦',
        cost: fz.cost,
        disabled: !chk.ok,
        active: !!s.fortifying,
        press: () => c.cmdFortify(s.id),
        tip: { title: fz.name, desc: 'Ring the settlement with walls; gatehouses open only for your troops.', extra: chk.ok ? costHtml(fz.cost, res) : chk.reason },
      });
    }
    if (s.isCapital && s.owner === c.playerFaction && !w.settlementSys.marketCount(c.playerFaction as FactionId))
      acts.push({ id: 'trade', label: 'TRADE', glyph: '⚖', press: () => this.openTradeSheet(), tip: { title: 'Royal caravans', desc: 'Trade goods for gold at poor rates. Build a Market for better ones.' } });
    if (core && core.def.category === 'core' && w.settlementSys.allTrainableAt(core).length) acts.push({ id: 'rally', label: 'RALLY', glyph: '⚑', active: this.mode === 'rally', press: () => c.setMode(this.mode === 'rally' ? 'default' : 'rally'), tip: { title: 'Set rally point', desc: 'New recruits gather there.' } });
    return acts;
  }

  private mercActions(b: Building): Action[] {
    const c = this.client;
    const w = c.world;
    const ev = w.events2 as unknown as { camps: { buildingId: number; stock: Record<string, number> }[]; campNear(f: FactionId, b: number): boolean; hire(f: FactionId, b: number, t: string): { ok: boolean; reason?: string } };
    const camp = ev.camps.find((x) => x.buildingId === b.id);
    if (!camp) return [];
    const res = w.player!.res as unknown as Record<string, number>;
    const near = ev.campNear(c.playerFaction as FactionId, b.id);
    return Object.entries(camp.stock).map(([type, n]) => ({
      id: 'merc_' + type,
      label: UNITS[type].name.toUpperCase().replace('VETERAN ', 'VET '),
      img: portraitUrl(type, this.colorOf(c.playerFaction)),
      cost: UNITS[type].cost,
      badge: String(n),
      disabled: !near || n <= 0,
      press: () => {
        const r = ev.hire(c.playerFaction as FactionId, b.id, type);
        if (!r.ok) c.toast(r.reason ?? 'Cannot hire', true);
        else audio.play('coins');
      },
      tip: { title: UNITS[type].name, desc: UNITS[type].desc, extra: near ? costHtml(UNITS[type].cost, res) : 'Move troops next to the camp to hire' },
    }));
  }

  private refreshActions() {
    const acts = this.actionsFor();
    const sig = this.mode + '|' + acts.map((a) => `${a.id}:${a.disabled ? 1 : 0}:${a.active ? 1 : 0}:${a.badge ?? ''}:${a.label}`).join(',');
    if (sig === this.actSig) return;
    this.actSig = sig;
    clear(this.actEl);
    const n = Math.min(9, acts.length);
    const rows = Math.ceil(n / 3);
    const cells: (Action | null)[] = new Array(rows * 3).fill(null);
    for (let i = 0; i < n; i++) {
      const row = rows - 1 - Math.floor(i / 3);
      const col = 2 - (i % 3);
      cells[row * 3 + col] = acts[i];
    }
    this.actEl.style.direction = 'ltr';
    for (const a of cells) {
      if (!a) {
        el('div', '', this.actEl);
        continue;
      }
      const b = el('button', `act ${a.disabled ? 'disabled' : ''} ${a.active ? 'active' : ''}`, this.actEl) as HTMLButtonElement;
      if (a.img) (el('img', '', b) as HTMLImageElement).src = a.img;
      else if (a.glyph) el('span', 'glyph', b, a.glyph);
      el('span', a.label.length > 7 ? 'al long' : 'al', b, a.label);
      if (a.badge) el('span', 'badge', b, a.badge);
      if (a.key && !matchMedia('(pointer: coarse)').matches) el('span', 'key', b, a.key);
      onPress(b, () => a.press(), { long: a.long ?? (a.tip ? () => this.showTipFor(b, a.tip!) : undefined), sound: () => audio.play('ui_click') });
      if (a.tip) this.tip(b, () => a.tip!);
    }
  }

  // ------------------------------------------------------------------ sheets
  closeSheet() {
    if (this.sheetEl) {
      this.sheetEl.parentElement?.remove();
      this.sheetEl = null;
      this.buildCtx = null;
    }
  }

  private sheet(title: string): HTMLElement {
    this.closeSheet();
    const back = el('div', 'sheet-back', this.root);
    onPress(back, () => this.closeSheet());
    const sh = el('div', 'sheet panel', back);
    sh.addEventListener('pointerdown', (e) => e.stopPropagation());
    sh.addEventListener('pointerup', (e) => e.stopPropagation());
    const h = el('h3', '', sh, `<span>${title}</span>`);
    const x = el('button', 'hud-btn', h, '✕') as HTMLButtonElement;
    onPress(x, () => this.closeSheet(), { sound: () => audio.play('ui_close') });
    this.sheetEl = sh;
    return sh;
  }

  openBuildSheet(region: number, plot: number) {
    const c = this.client;
    const w = c.world;
    const s = w.settlements[region];
    if (s.owner !== c.playerFaction) return;
    const sh = this.sheet(`Build in ${s.name}`);
    this.buildCtx = { region, plot };
    const grid = el('div', 'grid', sh);
    const f = w.player!;
    const res = f.res as unknown as Record<string, number>;
    for (const type of BUILD_MENU) {
      const def = BUILDINGS[type];
      const card = el('div', 'card', grid);
      card.dataset.type = type;
      (el('img', 'prev', card) as HTMLImageElement).src = buildingPreviewUrl(type, f.color);
      const t = el('div', '', card);
      el('div', 'cn', t, def.name);
      el('div', 'ch', t, def.hint);
      el('div', 'cc', t, costHtml(def.cost, res));
      el('div', 'cr', t, '');
      onPress(card, () => {
        if (c.cmdBuild(region, plot, type)) this.closeSheet();
      }, { sound: () => audio.play('ui_click') });
      this.tip(card, () => ({ title: def.name, desc: def.desc }));
    }
    this.refreshSheetAffordability();
  }

  private refreshSheetAffordability() {
    if (!this.sheetEl || !this.buildCtx) return;
    const c = this.client;
    const w = c.world;
    const { region, plot } = this.buildCtx;
    const s = w.settlements[region];
    const res = w.player!.res as unknown as Record<string, number>;
    this.sheetEl.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      const type = card.dataset.type!;
      let chk;
      if (plot >= 0) chk = w.settlementSys.canBuild(c.playerFaction as FactionId, region, plot, type);
      else {
        // any plot works?
        chk = { ok: false, reason: 'No suitable free plot' } as { ok: boolean; reason?: string };
        for (let i = 0; i < s.unlockedPlots; i++) {
          if (s.plots[i].buildingId) continue;
          const r = w.settlementSys.canBuild(c.playerFaction as FactionId, region, i, type);
          if (r.ok) {
            chk = r;
            break;
          }
          if (r.reason === 'Not enough resources' || chk.reason === 'No suitable free plot') chk = r;
        }
      }
      card.classList.toggle('disabled', !chk.ok);
      const cr = card.querySelector('.cr')!;
      const txt = chk.ok ? '' : chk.reason === 'Not enough resources' ? '' : chk.reason ?? '';
      if (cr.textContent !== txt) cr.textContent = txt;
      const cc = card.querySelector('.cc')!;
      const html = costHtml(BUILDINGS[type].cost, res);
      if (cc.innerHTML !== html) cc.innerHTML = html;
    });
  }

  private openTradeSheet() {
    const c = this.client;
    const w = c.world;
    const n = w.settlementSys.marketCount(c.playerFaction as FactionId);
    const sh = this.sheet(n ? 'Market' : 'Royal Caravans');
    const r = tradeRates(n);
    el('div', 'sel-sub', sh, n ? `Trade lots of ${TRADE_LOT}. More markets give better rates.` : `Trade lots of ${TRADE_LOT} at poor rates. Build a Market for better ones.`);
    const grid = el('div', 'grid', sh);
    for (const res of ['food', 'wood', 'stone'] as const) {
      const sell = el('div', 'card', grid);
      (el('img', 'prev', sell) as HTMLImageElement).src = icon(res);
      el('div', '', sell, `<div class="cn">Sell ${TRADE_LOT} ${res}</div><div class="ch">+${r.sell} gold</div>`);
      onPress(sell, () => c.cmdTrade(res, false));
      const buy = el('div', 'card', grid);
      (el('img', 'prev', buy) as HTMLImageElement).src = icon(res);
      el('div', '', buy, `<div class="cn">Buy ${TRADE_LOT} ${res}</div><div class="ch">−${r.buy} gold</div>`);
      onPress(buy, () => c.cmdTrade(res, true));
    }
  }

  // ------------------------------------------------------------------ modals
  modal(title: string, text: string, buttons: { label: string; fn: () => void; primary?: boolean }[], autoClose?: number): HTMLElement {
    const back = el('div', 'modal-back', this.root);
    const m = el('div', 'modal panel', back);
    el('h2', '', m, title);
    el('p', '', m, text);
    const row = el('div', 'row', m);
    for (const b of buttons) {
      const btn = el('button', `hud-btn ${b.primary ? 'active' : ''}`, row, b.label) as HTMLButtonElement;
      onPress(btn, () => {
        back.remove();
        b.fn();
      }, { sound: () => audio.play('ui_click') });
    }
    if (autoClose) setTimeout(() => back.remove(), autoClose);
    return back;
  }

  private ceasefireModal(id: number, from: FactionId, against: FactionId, dur: number) {
    const w = this.client.world;
    const fa = w.factions[from];
    const fb = w.factions[against];
    audio.play('notification');
    this.modal(
      '🕊 Ceasefire Offered',
      `${fb.name} grows too powerful.<br><b style="color:${fa.color.light}">${fa.name}</b> proposes a ${Math.round(dur / 60)}-minute ceasefire.`,
      [
        { label: 'ACCEPT', fn: () => w.diplomacy.answerOffer(id, true), primary: true },
        { label: 'DECLINE', fn: () => w.diplomacy.answerOffer(id, false) },
      ],
      24000,
    );
  }

  // ------------------------------------------------------------------ tooltips
  private tip(e: HTMLElement, get: () => { title: string; desc?: string; extra?: string }) {
    if (matchMedia('(pointer: coarse)').matches) return;
    e.addEventListener('pointerenter', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      this.showTip(get(), ev.clientX, ev.clientY);
    });
    e.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      this.placeTip(ev.clientX, ev.clientY);
    });
    e.addEventListener('pointerleave', () => (this.tooltipEl.style.display = 'none'));
    e.addEventListener('pointerdown', () => (this.tooltipEl.style.display = 'none'));
  }

  private showTip(t: { title: string; desc?: string; extra?: string }, x: number, y: number) {
    this.tooltipEl.innerHTML = `<div class="tt">${t.title}</div>${t.desc ? `<div class="td">${t.desc}</div>` : ''}${t.extra ? `<div class="td">${t.extra}</div>` : ''}`;
    this.tooltipEl.className = 'tooltip panel dark';
    this.tooltipEl.style.display = 'block';
    this.placeTip(x, y);
  }

  private showTipFor(e: HTMLElement, t: { title: string; desc?: string; extra?: string }) {
    const r = e.getBoundingClientRect();
    this.showTip(t, r.left, r.top - 10);
    setTimeout(() => (this.tooltipEl.style.display = 'none'), 2500);
  }

  private placeTip(x: number, y: number) {
    const t = this.tooltipEl;
    // measure at the origin so the box never shrink-wraps against the right edge
    t.style.left = '0px';
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    t.style.left = `${Math.min(window.innerWidth - w - 6, Math.max(6, x + 14))}px`;
    t.style.top = `${Math.max(6, y - h - 12)}px`;
  }

  // ------------------------------------------------------------------ keyboard
  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const c = this.client;
    const sel = c.selection;
    const cam = c.scene?.camCtl;
    const k = e.key;
    if (k >= '1' && k <= '9') {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        sel.assignArmy(n);
        this.renderArmies();
        this.toast(`Army ${ROMAN[n]} formed`);
      } else if (sel.selectArmy(n)) {
        audio.play('select_army');
        if (e.shiftKey) this.focusArmy(n);
      }
      return;
    }
    switch (k.toLowerCase()) {
      case 'escape':
        if (this.sheetEl) this.closeSheet();
        else if (this.mode !== 'default') c.setMode('default');
        else if (sel.units.size || sel.building || sel.region >= 0) sel.clear();
        else this.onMenu?.();
        break;
      case 'a':
        if (sel.units.size) c.setMode('attack');
        break;
      case 'm':
        if (sel.units.size) c.setMode('move');
        break;
      case 'g':
        c.cmdHold();
        break;
      case 's':
        if (sel.units.size) c.cmdStop();
        break;
      case 'f':
        if (sel.units.size) c.cycleFormation();
        break;
      case 'q':
        c.selectAllMilitary();
        break;
      case '.':
        c.selectIdle();
        break;
      case 'b': {
        const s = this.selected();
        const rid = s?.kind === 'region' ? s.s.id : s?.kind === 'building' ? s.b.settlementId : -1;
        if (rid >= 0 && c.world.settlements[rid].owner === c.playerFaction) this.openBuildSheet(rid, -1);
        break;
      }
      case ' ':
        e.preventDefault();
        c.jumpToAlert();
        break;
      case 'home':
      case 'h':
        c.jumpCapital();
        break;
      case 'p':
        this.onMenu?.();
        break;
      case 'arrowleft':
        if (cam) cam.keys.left = true;
        break;
      case 'arrowright':
        if (cam) cam.keys.right = true;
        break;
      case 'arrowup':
        if (cam) cam.keys.up = true;
        break;
      case 'arrowdown':
        if (cam) cam.keys.down = true;
        break;
      case '+':
      case '=':
        cam?.zoomAt(1.25, cam.viewW / 2, cam.viewH / 2);
        break;
      case '-':
        cam?.zoomAt(0.8, cam.viewW / 2, cam.viewH / 2);
        break;
      case '`':
      case 'f3':
        this.toggleDebug();
        break;
    }
  };

  keyUp = (e: KeyboardEvent) => {
    const cam = this.client.scene?.camCtl;
    if (!cam) return;
    switch (e.key.toLowerCase()) {
      case 'arrowleft':
        cam.keys.left = false;
        break;
      case 'arrowright':
        cam.keys.right = false;
        break;
      case 'arrowup':
        cam.keys.up = false;
        break;
      case 'arrowdown':
        cam.keys.down = false;
        break;
    }
  };

  // ------------------------------------------------------------------ debug
  toggleDebug() {
    if (this.debugEl) {
      this.debugEl.remove();
      this.debugEl = null;
      return;
    }
    this.debugEl = el('div', 'debug', this.root);
  }

  private refreshDebug() {
    const w = this.client.world;
    const ai = w.ai as unknown as { controllers: Map<number, { debug: Record<string, unknown> }> } | null;
    const lines: string[] = [];
    lines.push(`time ${formatTime(w.time)}  units ${w.units.length}  buildings ${w.buildings.length}  proj ${w.combat.projectiles.length}`);
    lines.push(`paths ${w.pathfinder.requests}  expansions ${w.pathfinder.expansions}`);
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL) continue;
      lines.push(`\n${f.name.toUpperCase()} ${f.alive ? '' : '(DEAD)'} — ${f.personality.label}`);
      lines.push(`  regions ${f.regionsOwned}  pop ${Math.round(f.pop)}/${f.popCap}  res g${f.res.gold | 0} w${f.res.wood | 0} f${f.res.food | 0} s${f.res.stone | 0}`);
      lines.push(`  income g${f.income.gold | 0} w${f.income.wood | 0} f${f.income.food | 0} s${f.income.stone | 0}`);
      const d = ai?.controllers.get(f.id)?.debug;
      if (d) {
        lines.push(`  GOAL ${d.goal}   TARGET ${d.target}`);
        lines.push(`  THREAT ${JSON.stringify(d.threat)}`);
        lines.push(`  ARMY ${d.army} power ${d.power}   WARS ${(d.wars as string[]).join(', ') || '-'}`);
        lines.push(`  ECON ${d.econ}`);
        for (const sq of d.squads as string[]) lines.push(`   · ${sq}`);
      }
    }
    this.debugEl!.textContent = lines.join('\n');
  }
}

const RES_DESC: Record<string, string> = {
  gold: 'Soldiers, upgrades, elite units and settlement growth. From taxes, mines and markets.',
  wood: 'Buildings, archers and siege engines. From lumber camps in forests.',
  food: 'Feeds recruits and growing towns. From farms and villages.',
  stone: 'Castles, walls, towers and advanced upgrades. From quarries and mines.',
};

const UPGRADE_DESC: Record<string, string> = {
  Town: '+6 population, more plots, stables, blacksmiths, markets and stronger troops.',
  'Castle Town': 'Elite units (knights, pikemen, veterans, longbowmen), stone walls, more plots.',
  'Royal Capital': 'A grander castle: elite units, more plots, higher taxes and population.',
};

export { unitClass };
