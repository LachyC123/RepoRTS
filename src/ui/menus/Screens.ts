import { audio } from '../../audio';
import { settings, type SettingsData } from '../../core/Settings';
import { formatTime } from '../../core/math';
import { CRESTS, DIFFICULTIES, KINGDOM_COLORS, type CrestId, type Difficulty } from '../../data/factions';
import { DOMINATION_SHARE, NEUTRAL } from '../../data/constants';
import type { PlayerChoices } from '../../game/matchSetup';
import type { World } from '../../sim/World';
import { installFrames } from '../hud/assets';
import { clear, el, onPress } from '../hud/dom';
import { crestUrl } from '../uiArt';
import './menus.css';

const click = () => audio.play('ui_click');

function btn(parent: HTMLElement, label: string, fn: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `mbtn ${cls}`, parent, label) as HTMLButtonElement;
  onPress(b, fn, { sound: click });
  return b;
}

export function mainMenu(root: HTMLElement, h: { play: () => void; howTo: () => void; settings: () => void; credits: () => void; quick?: () => void }): HTMLElement {
  installFrames();
  const s = el('div', 'screen main', root);
  const tb = el('div', 'title-block', s);
  el('div', 'title', tb, 'Crownshire');
  el('div', 'subtitle', tb, 'FOUR KINGDOMS · ONE VALLEY');
  const col = el('div', 'menu-col', s);
  btn(col, 'PLAY', h.play, 'primary');
  btn(col, 'HOW TO PLAY', h.howTo);
  btn(col, 'SETTINGS', h.settings);
  btn(col, 'CREDITS', h.credits);
  el('div', 'version', s, 'v1.0 · Crownshire Valley');
  return s;
}

export function setupScreen(root: HTMLElement, initial: PlayerChoices, h: { start: (c: PlayerChoices) => void; back: () => void }): HTMLElement {
  const c: PlayerChoices = { ...initial };
  const s = el('div', 'screen dim', root);
  const d = el('div', 'dialog panel', s);
  const h1 = el('h1', '', d, 'Raise Your Banner');
  el('h2', '', d, 'ERA');
  const eraRow = el('div', 'row era-row', d);
  const realmH = el('h2', '', d, 'KINGDOM');
  const nameRow = el('div', 'row', d);
  const nameIn = el('input', 'text-in', nameRow) as HTMLInputElement;
  nameIn.value = c.kingdomName.replace(/^(Kingdom|Republic) of /, '');
  nameIn.maxLength = 22;
  nameIn.placeholder = 'Kingdom name';
  const cmdH = el('h2', '', d, 'COMMANDER');
  const cmdRow = el('div', 'row', d);
  const cmdIn = el('input', 'text-in', cmdRow) as HTMLInputElement;
  cmdIn.value = c.commanderName;
  cmdIn.maxLength = 16;
  el('h2', '', d, 'CREST');
  const crestRow = el('div', 'row', d);
  el('h2', '', d, 'COLOURS');
  const colorRow = el('div', 'row', d);
  const renderCrests = () => {
    clear(crestRow);
    const col = KINGDOM_COLORS.find((k) => k.id === c.color)!;
    for (const cr of CRESTS) {
      const ch = el('div', `choice ${c.crest === cr ? 'on' : ''}`, crestRow);
      (el('img', '', ch) as HTMLImageElement).src = crestUrl(cr, col);
      el('span', '', ch, cr[0].toUpperCase() + cr.slice(1));
      onPress(ch, () => {
        c.crest = cr as CrestId;
        renderCrests();
      }, { sound: click });
    }
  };
  const renderColors = () => {
    clear(colorRow);
    for (const k of KINGDOM_COLORS) {
      const ch = el('div', `choice ${c.color === k.id ? 'on' : ''}`, colorRow);
      const sw = el('span', 'swatch', ch);
      sw.style.background = k.main;
      el('span', '', ch, k.name);
      onPress(ch, () => {
        c.color = k.id;
        renderColors();
        renderCrests();
      }, { sound: click });
    }
  };
  renderCrests();
  renderColors();
  const ERAS: { id: 'medieval' | 'modern'; icon: string; name: string; desc: string }[] = [
    { id: 'medieval', icon: '⚔', name: 'Medieval', desc: 'Swords, bows, knights and castles' },
    { id: 'modern', icon: '🪖', name: 'Modern', desc: 'Rifles, tanks, mortars and bunkers' },
  ];
  const renderEra = () => {
    clear(eraRow);
    const era = c.era ?? 'medieval';
    for (const e of ERAS) {
      const ch = el('div', `choice era-card ${era === e.id ? 'on' : ''}`, eraRow);
      el('span', 'era-icon', ch, e.icon);
      el('b', '', ch, e.name);
      el('span', 'era-desc', ch, e.desc);
      onPress(ch, () => {
        c.era = e.id;
        renderEra();
      }, { sound: click });
    }
    const modern = era === 'modern';
    h1.textContent = modern ? 'Raise Your Flag' : 'Raise Your Banner';
    realmH.textContent = modern ? 'NATION' : 'KINGDOM';
    cmdH.textContent = modern ? 'GENERAL' : 'COMMANDER';
    nameIn.placeholder = modern ? 'Nation name' : 'Kingdom name';
  };
  renderEra();
  el('h2', '', d, 'DIFFICULTY');
  const diffRow = el('div', 'row', d);
  const diffDesc: Record<Difficulty, string> = {
    casual: 'Relaxed rivals who think slowly.',
    normal: 'A fair fight for a new ruler.',
    hard: 'Quick, efficient warlords.',
    warlord: 'Ruthless. AI earns +15% income.',
  };
  const descEl = el('div', '', d);
  descEl.style.cssText = 'font-size:0.85em;color:#c8d0a0;margin-top:4px;min-height:1.2em';
  const renderDiff = () => {
    clear(diffRow);
    for (const k of Object.keys(DIFFICULTIES) as Difficulty[]) {
      const ch = el('div', `choice ${c.difficulty === k ? 'on' : ''}`, diffRow, DIFFICULTIES[k].label);
      onPress(ch, () => {
        c.difficulty = k;
        renderDiff();
      }, { sound: click });
    }
    descEl.textContent = diffDesc[c.difficulty];
  };
  renderDiff();
  el('h2', '', d, 'MAP');
  const mapRow = el('div', 'row', d);
  el('div', 'choice on', mapRow, '🗺 Crownshire Valley');
  el('div', 'choice off', mapRow, 'Frostmarch — coming soon');
  el('div', 'choice off', mapRow, 'Saltmere Isles — coming soon');
  el('h2', '', d, 'OPTIONS');
  const optRow = el('div', 'row', d);
  const optDesc = el('div', 'opt-desc', d);
  const opt = (label: string, key: 'tutorial' | 'living' | 'autoArmies' | 'sandbox', desc: string) => {
    const ch = el('div', `choice ${c[key] ? 'on' : ''}`, optRow, label);
    ch.title = desc;
    onPress(ch, () => {
      c[key] = !c[key];
      ch.classList.toggle('on', !!c[key]);
      optDesc.textContent = desc;
    }, { sound: click });
    ch.addEventListener('pointerenter', () => (optDesc.textContent = desc));
  };
  opt('Guided first match', 'tutorial', 'A gentle walkthrough of the basics; rivals hold off a while.');
  opt('Living soldiers', 'living', 'Every soldier has a name and a personality. The wounded can be saved by their friends. Some panic, some go berserk, some nap.');
  opt('Self-running armies', 'autoArmies', 'Your soldiers defend, expand and fight on their own. Give an order and they follow it, then go back to thinking for themselves.');
  opt('Sandbox', 'sandbox', 'No victory conditions. The war goes on as long as you like.');
  optDesc.textContent = 'Hover or tap an option to read about it.';
  const foot = el('div', 'foot', d);
  btn(foot, 'BACK', h.back);
  btn(foot, 'BEGIN', () => {
    const nm = nameIn.value.trim() || 'Aldmere';
    const prefix = c.era === 'modern' ? 'Republic of' : 'Kingdom of';
    c.kingdomName = /^(kingdom|republic) of /i.test(nm) ? nm : `${prefix} ${nm}`;
    c.commanderName = cmdIn.value.trim() || 'Edmund';
    h.start(c);
  }, 'primary');
  return s;
}

export function settingsScreen(root: HTMLElement, h: { back: () => void; resetTutorial?: () => void }): HTMLElement {
  const s = el('div', 'screen dim', root);
  const d = el('div', 'dialog panel', s);
  el('h1', '', d, 'Settings');
  const data = settings.data;
  const slider = (label: string, key: keyof SettingsData, min: number, max: number, step: number, fmt = (v: number) => `${Math.round(v * 100)}%`) => {
    const row = el('div', 'setting', d);
    const lab = el('label', '', row, `${label} <span style="color:#c8d0a0">${fmt(data[key] as number)}</span>`);
    const inp = el('input', '', row) as HTMLInputElement;
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(data[key]);
    inp.addEventListener('input', () => {
      (settings.data as unknown as Record<string, number>)[key] = Number(inp.value);
      lab.innerHTML = `${label} <span style="color:#c8d0a0">${fmt(Number(inp.value))}</span>`;
      settings.save();
      audio.setVolumes(settings.data.master, settings.data.music, settings.data.sfx);
    });
    inp.addEventListener('change', () => audio.play('ui_click'));
  };
  const toggle = (label: string, key: keyof SettingsData, desc = '') => {
    const row = el('div', 'setting', d);
    el('label', '', row, `${label}${desc ? `<br><span style="font-size:0.75em;color:#a89a80">${desc}</span>` : ''}`);
    const t = el('div', `toggle ${data[key] ? 'on' : ''}`, row);
    onPress(t, () => {
      (settings.data as unknown as Record<string, boolean>)[key] = !data[key];
      t.classList.toggle('on', !!data[key]);
      settings.save();
    }, { sound: click });
  };
  const seg = (label: string, key: keyof SettingsData, opts: [string, string][]) => {
    const row = el('div', 'setting', d);
    el('label', '', row, label);
    const sg = el('div', 'seg', row);
    const render = () => {
      clear(sg);
      for (const [v, l] of opts) {
        const ch = el('div', `choice ${data[key] === v ? 'on' : ''}`, sg, l);
        onPress(ch, () => {
          (settings.data as unknown as Record<string, string>)[key] = v;
          settings.save();
          render();
        }, { sound: click });
      }
    };
    render();
  };
  el('h2', '', d, 'AUDIO');
  slider('Master volume', 'master', 0, 1, 0.05);
  slider('Music', 'music', 0, 1, 0.05);
  slider('Sound effects', 'sfx', 0, 1, 0.05);
  el('h2', '', d, 'GRAPHICS');
  seg('Quality', 'graphics', [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ]);
  toggle('Reduced effects', 'reducedEffects', 'Fewer particles, no lingering arrows');
  toggle('Screen shake', 'screenShake');
  toggle('Show FPS', 'showFps');
  el('h2', '', d, 'CONTROLS');
  slider('Camera sensitivity', 'cameraSensitivity', 0.4, 2, 0.1, (v) => `${v.toFixed(1)}×`);
  toggle('Edge scrolling (desktop)', 'edgeScroll');
  toggle('Game speed controls (desktop)', 'gameSpeedControls');
  el('h2', '', d, 'ACCESSIBILITY');
  slider('Interface scale', 'uiScale', 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`);
  toggle('Large buttons', 'largeButtons', 'Bigger touch targets');
  toggle('Colour-blind border symbols', 'colorblindSymbols', 'Adds shapes to territory borders');
  el('h2', '', d, 'ADVANCED');
  toggle('Debug overlay (`)', 'debug', 'AI goals, threats and economy');
  const foot = el('div', 'foot', d);
  if (h.resetTutorial) btn(foot, 'RESET TUTORIAL', () => {
    settings.set('tutorialDone', false);
    h.resetTutorial?.();
  });
  btn(foot, 'DEFAULTS', () => {
    settings.reset();
    audio.setVolumes(settings.data.master, settings.data.music, settings.data.sfx);
    s.remove();
    settingsScreen(root, h);
  });
  btn(foot, 'DONE', () => {
    s.remove();
    h.back();
  }, 'primary');
  return s;
}

export function howToPlay(root: HTMLElement, back: () => void): HTMLElement {
  const s = el('div', 'screen dim', root);
  const d = el('div', 'dialog panel', s);
  el('h1', '', d, 'How to Play');
  const cards: [string, string[]][] = [
    ['THE GOAL', ['Four kingdoms share Crownshire Valley. Win by <b>Domination</b> — hold 70% of the regions for 90 seconds — or <b>Elimination</b> — destroy every rival Capital Castle.', 'A kingdom that loses its capital has 60 seconds to crown a new one in a surviving town.']],
    ['READING THE MAP', ['Every kingdom tints its land in its own colour and edges it with banner posts: your colour is shown in the KINGDOMS list (top right) beside each rival, with how they stand with you: <b>Peace</b>, <b>Hostile</b>, <b>At war</b> or <b>Truce</b>.', 'Land with no tint is <b>unclaimed</b>. Rest the mouse on the map (or tap a settlement) to see whose land it is.']],
    ['TERRITORY', ['Every region has a capture point: a village square, tower or landmark. Stand soldiers on it to claim it. More soldiers capture faster; any enemy presence pauses the capture.', 'Towns and castles must have their hall or keep <b>breached</b> first.']],
    ['ECONOMY', ['Gold, wood, food and stone flow in from taxes, owned regions and buildings. Select a settlement and tap a glowing plot (or BUILD) to construct.', 'Workers staff farms, camps and mines automatically — but they flee raiders, and production stops until it is safe.', 'Short of one good? Markets trade it for gold — and even without one, your capital\'s royal caravans will, at poor rates.']],
    ['ARMIES', ['Train troops at your capital, barracks, ranges, stables and workshops. Upgrade villages into towns and castles to unlock elite units.', 'Spears beat cavalry · cavalry beats archers · archers beat slow infantry · shields beat archers · siege beats walls.']],
    ['SOLDIERS WITH LIVES', ['With <b>Living soldiers</b> on, every soldier has a name, a rank and a trait. Brave ones steady their friends; nervous ones may bolt; hotheads go berserk; jokers lift the mood; the lazy nap; the curious wander off after ducks.', 'Most who fall are only <b>wounded</b>: a red cross and a bleed-out bar appear over them. Friends (the loyal first) run in to drag them back up, and the wounded heal in your own land. Survivors earn ranks. Press <b>J</b> or JOURNAL for their stories and the roll of the fallen.']],
    ['ARMIES THAT THINK', ['With <b>Self-running armies</b> on, free soldiers defend your settlements, claim free land and (on CONQUER) attack your enemies by themselves. Change what they may do with the policy button (EXPAND · CONQUER · DEFEND · MANUAL, or T).', 'Any order you give takes command of those soldiers. When they finish and stand idle for 30 seconds they go back to their own judgement; DEFEND keeps them where you put them. SET FREE hands them back at once.']],
    ['ERAS', ['<b>Medieval</b>: swords, bows, knights, catapults and castles. <b>Modern</b>: rifles, machine guns, rockets, tanks, mortars, howitzers and bunkers on the same valley. The units do the same jobs in both: spearmen and AT riflemen both stop charges.', '<b>Sandbox</b> turns off victory: the war goes on as long as you like.']],
    ['DESKTOP', ['Left-click select · drag to box-select · right-click move/attack.', 'A attack-move · M move · G defend · F formation · Ctrl+1–9 make an army · 1–9 select it · Space last alert · T free/command · J journal · wheel zoom · arrows/edges pan.']],
    ['MOBILE', ['Tap a unit to select · drag from your troops (or hold, then drag) to box-select · tap the ground to move · tap an enemy to attack.', 'Press and hold, then lift: on a soldier, select all of that type nearby; with troops selected, advance there and fight anything on the way.', 'One finger on empty ground pans; two fingers pan and pinch-zoom. Dragging never issues orders. Use the action bar for everything else.']],
    ['THE WORLD', ['Rival kingdoms fight each other, not just you. Watch for wars, raids, ceasefire offers, mercenary companies, gold veins and treasure.', 'Crownkeep, the island fortress, grants taxes, vision and prestige — and is always contested.']],
    ['MORALE & COMMANDERS', ['Outnumbered or shattered troops may rout and rally later. Your commander inspires nearby soldiers and returns 60s after falling.', 'Keep your army together, flank with cavalry, and bring siege to the walls.']],
  ];
  const grid = el('div', 'htp-page', d);
  for (const [t, ps] of cards) {
    const c = el('div', 'htp-card panel dark', grid);
    el('h3', '', c, t);
    for (const p of ps) el('p', '', c, p);
  }
  const foot = el('div', 'foot', d);
  btn(foot, 'BACK', () => {
    s.remove();
    back();
  }, 'primary');
  return s;
}

export function credits(root: HTMLElement, back: () => void): HTMLElement {
  const s = el('div', 'screen dim', root);
  const d = el('div', 'dialog panel', s);
  el('h1', '', d, 'Credits');
  el('p', '', d, '<div style="text-align:center;line-height:1.7">A medieval four-kingdom strategy game.<br><br><b>Design, code, pixel art, sound & music</b><br>Generated procedurally — every sprite, tile, sound effect and melody is created in your browser at run time.<br><br><b>Built with</b><br>TypeScript · Phaser 3 · Vite · WebAudio<br>Fonts: Pixelify Sans, Jacquarda Bastarda 9, Silkscreen (SIL Open Font License)<br><br>Thank you for playing.</div>');
  const foot = el('div', 'foot', d);
  btn(foot, 'BACK', () => {
    s.remove();
    back();
  }, 'primary');
  return s;
}

export function pauseMenu(root: HTMLElement, h: { resume: () => void; settings: () => void; howTo: () => void; restart: () => void; quit: () => void }): HTMLElement {
  const s = el('div', 'screen dim', root);
  const d = el('div', 'dialog panel', s);
  d.style.width = 'min(340px, 90vw)';
  el('h1', '', d, 'Paused');
  const col = el('div', 'menu-col', d);
  col.style.marginTop = '8px';
  col.style.width = '100%';
  btn(col, 'RESUME', h.resume, 'primary');
  btn(col, 'SETTINGS', h.settings);
  btn(col, 'HOW TO PLAY', h.howTo);
  btn(col, 'RESTART MATCH', h.restart);
  btn(col, 'QUIT TO MENU', h.quit);
  return s;
}

export function loadingScreen(root: HTMLElement): { el: HTMLElement; set: (frac: number, text?: string) => void; done: () => void } {
  installFrames();
  const s = el('div', 'loading', root);
  el('div', 'lt', s, 'Crownshire');
  const bar = el('div', 'bar', s);
  const fill = el('i', '', bar);
  const hint = el('div', 'hint', s, HINTS[Math.floor(Math.random() * HINTS.length)]);
  return {
    el: s,
    set: (f, text) => {
      fill.style.width = `${Math.round(f * 100)}%`;
      if (text) hint.textContent = text;
    },
    done: () => {
      s.style.opacity = '0';
      setTimeout(() => s.remove(), 600);
    },
  };
}

const HINTS = [
  'Spearmen and pikemen stop cavalry charges cold.',
  'Raid enemy farms and mines: frightened workers stop working.',
  'Rival kingdoms war with each other. Strike while they are distracted.',
  'Crownkeep grants +10% taxes and sees far across the valley.',
  'Upgrade villages into towns to unlock stables, markets and blacksmiths.',
  'A capital that falls can be replaced — if you still hold a town.',
  'Hold 70% of the valley for 90 seconds to win by domination.',
  'Mercenary companies sell elite troops for gold to whoever reaches them first.',
];

export function endScreen(
  root: HTMLElement,
  world: World,
  player: number,
  h: { rematch: () => void; newMatch: () => void; menu: () => void },
): HTMLElement {
  const s = el('div', 'screen dim', root);
  const d = el('div', 'dialog panel end', s);
  const won = world.winner === player;
  const f = world.factions[player];
  el('div', `big ${won ? '' : 'defeat'}`, d, won ? 'Victory' : 'Defeat');
  const reason = won ? (world.endReason === 'domination' ? 'You hold the valley. All of Crownshire bows to your banner.' : 'Every rival crown lies in the dust.') : world.endReason === 'defeat' ? 'Your kingdom has fallen.' : `${world.factions[world.winner as number]?.name ?? 'A rival'} rules the valley.`;
  el('p', '', d, reason);
  const st = f.stats;
  const stats = el('div', 'stats', d);
  const add = (v: string, l: string) => {
    const c = el('div', 'stat panel dark', stats);
    el('div', 'sv', c, v);
    el('div', 'sl', c, l);
  };
  add(formatTime(world.time), 'TIME');
  add(`${Math.round(f.territoryShare * 100)}%`, 'TERRITORY');
  add(String(st.enemiesDefeated), 'ENEMIES DEFEATED');
  add(String(st.regionsCaptured), 'SETTLEMENTS CAPTURED');
  add(String(st.unitsKilled), 'UNITS DEFEATED');
  add(String(st.unitsLost), 'UNITS LOST');
  add(String(st.largestArmy), 'LARGEST ARMY');
  add(Math.round(st.goldEarned).toLocaleString('en-US'), 'GOLD EARNED');
  // territory over time: y auto-scales to the leader so early, close matches stay readable
  const gw = el('div', 'graph-wrap', d);
  const gh = el('div', 'graph-head', gw);
  el('span', 'gt', gh, 'TERRITORY OVER TIME');
  const legend = el('span', 'legend', gh);
  const g = el('canvas', 'graph', gw) as HTMLCanvasElement;
  const W = 300;
  const H = 60;
  g.width = W;
  g.height = H;
  const ctx = g.getContext('2d')!;
  ctx.fillStyle = '#1b1420';
  ctx.fillRect(0, 0, W, H);
  const facs = world.factions.filter((fac) => fac && fac.id !== NEUTRAL);
  let top = 0.25;
  for (const fac of facs) for (const v of fac.stats.history) top = Math.max(top, v * 1.15);
  top = Math.min(1, top);
  const yOf = (v: number) => Math.round(H - 3 - (v / top) * (H - 6)) + 0.5;
  ctx.fillStyle = '#2a2030';
  for (let q = 0.25; q < top; q += 0.25) ctx.fillRect(0, yOf(q) - 0.5, W, 1);
  if (DOMINATION_SHARE <= top) {
    ctx.fillStyle = '#7a5a30';
    for (let x = 0; x < W; x += 6) ctx.fillRect(x, yOf(DOMINATION_SHARE) - 0.5, 3, 1);
  }
  // the player's line last, so it sits on top
  facs.sort((a, b) => (a.id === player ? 1 : 0) - (b.id === player ? 1 : 0));
  for (const fac of facs) {
    const item = el('span', 'lg', legend);
    item.style.color = fac.color.light;
    item.textContent = `■ ${fac.name.replace(/^Kingdom of /, '')}`;
    const hdata = fac.stats.history;
    if (hdata.length < 2) continue;
    ctx.strokeStyle = fac.color.light;
    ctx.lineWidth = fac.id === player ? 2 : 1;
    ctx.beginPath();
    hdata.forEach((v, i) => {
      const x = (i / (hdata.length - 1)) * (W - 4) + 2;
      if (i === 0) ctx.moveTo(x, yOf(v));
      else ctx.lineTo(x, yOf(v));
    });
    ctx.stroke();
  }
  // the soldiers worth remembering: the living legends and the fallen
  const lv = world.living;
  if (lv) {
    const alive = world.units.filter((u) => u.alive && u.faction === player && u.persona && (u.persona.kills > 0 || u.persona.rescues > 0));
    alive.sort((a, b) => b.persona!.kills + b.persona!.rescues * 2 - (a.persona!.kills + a.persona!.rescues * 2));
    const fallen = [...(lv.fallen.get(player as never) ?? [])].sort((a, b) => b.kills + b.rescues * 2 - (a.kills + a.rescues * 2));
    if (alive.length || fallen.length) {
      const roll = el('div', 'roll', d);
      if (alive.length) {
        const col = el('div', 'roll-col', roll);
        el('div', 'gt', col, 'STILL STANDING');
        for (const u of alive.slice(0, 4)) el('div', 'roll-row', col, `<b>${lv.name(u, true)}</b> <span>${u.persona!.kills} kills${u.persona!.rescues ? ` · saved ${u.persona!.rescues}` : ''}</span>`);
      }
      if (fallen.length) {
        const col = el('div', 'roll-col', roll);
        el('div', 'gt', col, `IN MEMORY · ${fallen.length} FELL`);
        for (const x of fallen.slice(0, 4)) el('div', 'roll-row', col, `<b>${x.name}</b> <span>${x.kills} kills${x.rescues ? ` · saved ${x.rescues}` : ''}</span>`);
      }
    }
  }
  const foot = el('div', 'foot', d);
  btn(foot, 'REMATCH', h.rematch, 'primary');
  btn(foot, 'NEW MATCH', h.newMatch);
  btn(foot, 'MAIN MENU', h.menu);
  return s;
}

export function orientationGuard(root: HTMLElement) {
  const r = el('div', 'rotate enabled', root);
  el('div', 'phone', r);
  el('div', 'rt', r, 'Turn your device');
  el('div', '', r, 'Crownshire is played in landscape.');
  return r;
}
