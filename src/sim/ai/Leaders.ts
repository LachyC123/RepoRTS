import { NEUTRAL, type FactionId } from '../../data/constants';
import { DOCTRINE_IDS, DOCTRINES, PERSONALITY_DOCTRINE, QUIRK_IDS, QUIRKS, TRAIT_DOCTRINE, type DoctrineId, type QuirkId } from '../../data/doctrines';
import { eraState, resName, word } from '../../data/era';
import type { Unit } from '../units/Unit';
import type { World } from '../World';

/**
 * Leaders: every realm (the player's included) is run by someone with a doctrine and a mood. When a
 * commander falls, the most decorated soldier still standing takes over, and their personality
 * becomes the realm's: a hothead sergeant turns a careful kingdom into a warmongering one. Leaders
 * think out loud: their decisions and grumbles go to the war-room feed.
 */
export interface Leader {
  name: string;
  title: string;
  doctrine: DoctrineId;
  /** -1 desperate .. +1 smug */
  mood: number;
  since: number;
  /** how this leader came to power */
  origin: 'founder' | 'promoted' | 'appointed';
  /** next time they may speak (throttle) */
  speakT: number;
  /** next idle musing */
  museT: number;
  /** territory share samples for the mood */
  trend: number[];
  /** two personal quirks on top of the doctrine */
  quirks: QuirkId[];
  /** a bad omen: no new attacks until then */
  omenUntil: number;
  /** seconds spent desperate (long enough and someone stages a coup) */
  lowT: number;
}

export interface Thought {
  t: number;
  faction: FactionId;
  who: string;
  text: string;
  kind: ThoughtKind;
  x?: number;
  y?: number;
}

export type ThoughtKind =
  | 'attack'
  | 'capture'
  | 'defend'
  | 'retreat'
  | 'war'
  | 'peace'
  | 'build'
  | 'research'
  | 'counter'
  | 'missile'
  | 'won'
  | 'lost'
  | 'muse'
  | 'mood_up'
  | 'mood_down'
  | 'succession'
  | 'insult'
  | 'retort'
  | 'omen'
  | 'coup';

type Lines = Partial<Record<ThoughtKind, string[]>>;

const GENERIC: Lines = {
  attack: ['Send {squad} to {target}.', '{squad}, take {target}. No dawdling.', '{enemy} looks soft. We march on {target}.', 'Everyone to {target}. Bring snacks.', '{target} will be ours by supper.', 'Right. {target}. Go.'],
  capture: ['{squad} will plant our flag at {target}.', '{target} has nobody in charge. That changes now.', 'Plant the flag at {target}.', 'Free land at {target}. Mine now.'],
  defend: ['{squad}, get to {target}! Now!', '{target} is under attack! Everyone back!', 'They want {target}? Over my dead body. Ideally theirs.', 'Defend {target}! That is an order, not a suggestion.'],
  retreat: ['Fall back! That was a tactical experiment.', 'Retreat! Regroup! Re-something!', 'We are not running. We are advancing backwards.'],
  war: ['War on {enemy}. {reason}', '{enemy} has it coming. {reason}', 'I declare war on {enemy}! {reason}'],
  peace: ['A truce with {enemy}. For now.', 'Fine. Peace with {enemy}. I hate it.', 'We shake hands with {enemy}. Count your fingers after.'],
  build: ['A new {thing} at {target}.', 'Build a {thing} at {target}. Make it sturdy.', '{target} needs a {thing}. Obviously.'],
  research: ['Our clever people are working on {thing}.', '{thing}. Because science.', 'Fund {thing}. I want it yesterday.'],
  counter: ['Their {enemyUnit} keep beating us. Train more {unit}.', 'Enough. {unit}, and lots of them.', 'Lesson learned: {unit} beat {enemyUnit}.'],
  missile: ['Fire the {big} at {target}. Do it.', '{target}. Light them up.', 'Everyone cover your ears. Firing at {target}.'],
  won: ['{target} is ours!', 'Ha! {target} falls!', 'Another flag on the map. {target} is ours.'],
  lost: ['We lost {target}. Someone will pay for this.', '{target} has fallen... I need a moment.', 'They took {target}. Rude.'],
  mood_up: ['Things are going rather well, aren’t they?', 'I am, frankly, a genius.', 'Victory smells like {res}.'],
  mood_down: ['This is fine. Everything is fine.', 'Who planned this war? Oh. Me.', 'I would like a nap and a different war.'],
  succession: ['I’m in charge now. First order: nobody touch my chair.', 'Promoted! To... everything?', 'Right. New rules.'],
  retort: ['How DARE you, {enemy}!', 'I’ll remember that, {enemy}.', 'Says the one with the ugly flag!', 'At least my soldiers can count, {enemy}.', 'Oh yeah? Well— your mum, {enemy}.'],
  omen: ['Bad omen. Nobody attack anything today.', 'A black cat crossed my path. We wait.', 'The stars are wrong. Hold.'],
  coup: ['The old boss is gone. I’m in charge now.', 'Pack your bags, old fool. This is MY army.', 'The people demanded change. Mostly me. I demanded it.'],
  insult: ['{enemy}’s leader is a wet sock.', 'I’ve met smarter turnips than {enemy}’s leader.', '{enemy} smells of old cabbage.', 'Tell {enemy} their flag is ugly.'],
};

const DOCTRINE_LINES: Record<DoctrineId, Lines> = {
  warmonger: {
    attack: ['Attack {target}! Attack everything!', 'Odds? I don’t care about odds. {target}, now.', 'Why are we not already in {target}?'],
    muse: ['It has been four minutes without a war. I’m bored.', 'Peace is just war being lazy.', 'Who wants to start something?', 'More soldiers. No, more than that.'],
    retreat: ['Retreat?! ...Fine. But only to attack again.', 'We are regrouping. Angrily.'],
    peace: ['A truce with {enemy}? Who signed this? I did? Hm.'],
  },
  turtle: {
    attack: ['We have enough troops for {target}. Probably. Maybe. Let’s check again.', 'Very carefully: {target}.'],
    muse: ['One more wall. Then maybe another.', 'You can never have too many towers.', 'I heard a noise. Build a wall.', 'Safe is good. Safer is better.'],
    build: ['Another {thing}. Safety first.', 'A {thing} at {target}. Then another one.'],
    retreat: ['Back to the walls! I knew it was a trap!'],
  },
  tycoon: {
    muse: ['{res} up three percent. I may cry.', 'Is war tax-deductible?', 'Spend money to make money. And soldiers to... also make money.', 'Buy low, conquer high.'],
    build: ['A {thing} at {target}. Excellent return on investment.', 'Build a {thing}. The accountants agree.'],
    attack: ['{target} has excellent {res}. Acquire it.', 'Hostile takeover of {target}. Literally.'],
  },
  tinkerer: {
    muse: ['I’ve had an idea. It’s loud.', 'What if we put wheels on it? And more wheels?', 'The {big} needs a bigger {big}.', 'Science is going brilliantly. Nothing has exploded since lunch.'],
    research: ['{thing}! Finally!', 'My {thing} research is nearly done. Probably.'],
    missile: ['Testing the {big} on {target}. For science.', 'Calibration shot at {target}!'],
  },
  glory: {
    attack: ['Follow me to {target}! Watch me be brilliant!', 'Paint my portrait as I take {target}.', 'History will remember {target}. And me.'],
    muse: ['Commission another statue of me. Bigger.', 'Do you think the troops like me? They should.', 'My medals need medals.', 'Fetch the bards. I’ve done something heroic again.'],
    retreat: ['We retreat so I can return even more gloriously.'],
  },
  paranoid: {
    muse: ['The ducks are spying. I’m sure of it.', 'Who moved my map? WHO MOVED MY MAP?', 'Everyone is plotting. Even the cows.', 'Double the guard. Then guard the guard.'],
    peace: ['A truce with {enemy}? Obviously a trick.'],
    defend: ['I KNEW they’d go for {target}!'],
    missile: ['They were looking at us funny. Fire at {target}.'],
  },
  eccentric: {
    muse: ['What if we painted everything purple? Approved.', 'Today’s strategy is: vibes.', 'I have named my sword Gerald.', 'More bards. The war needs a soundtrack.', 'Let’s attack on a Tuesday. Is it Tuesday?'],
    attack: ['I have a good feeling about {target}. Also a strange one.', 'To {target}! Or was it the other one? {target}, fine.'],
    build: ['A {thing}? Sure, why not. Two, actually.'],
    missile: ['Fire at {target}. I flipped a coin.', 'Fire the {big}! At... {target}! Yes!'],
  },
  diplomat: {
    muse: ['Has anyone tried asking nicely?', 'Tea with {enemy} would fix everything.', 'Hugs, not wars. But also walls.', 'I’m writing a very stern letter.'],
    war: ['Regrettably, war with {enemy}. {reason}', 'I tried everything. Well, most things. War with {enemy}.'],
    peace: ['Peace with {enemy}! I knew they were nice deep down.'],
  },
};

const WAR_REASONS = {
  medieval: ['They stole our goat.', 'Their bard insulted our bard.', 'Their king laughed at my hat.', 'Their cows are on our side of the river.', 'Someone dreamed about it.', 'They know what they did.', 'It’s a Tuesday.', 'The fortune teller said so.'],
  modern: ['They stole our goat.', 'Their general laughed at my hat.', 'They parked a tank on our lawn.', 'Their anthem is too catchy.', 'They know what they did.', 'Someone sent a rude telegram.', 'The weather report said so.', 'Their mascot looked at me funny.'],
};

const MOOD_LABELS: [number, string][] = [
  [0.6, 'smug'],
  [0.25, 'confident'],
  [-0.25, 'steady'],
  [-0.6, 'worried'],
  [-2, 'desperate'],
];

export function moodLabel(m: number) {
  for (const [v, l] of MOOD_LABELS) if (m >= v) return l;
  return 'desperate';
}

const FIRST = {
  medieval: ['Wat', 'Edda', 'Godwin', 'Agnes', 'Piers', 'Ysolde', 'Ralf', 'Gisela', 'Hugh', 'Maud', 'Tybalt', 'Elric'],
  modern: ['Mike', 'Rosa', 'Dmitri', 'Kofi', 'Lena', 'Raj', 'Ana', 'Yuki', 'Priya', 'Marco', 'Nadia', 'Hank'],
};
const LAST = {
  medieval: ['Crowe', 'Ashdown', 'Pike', 'Holt', 'Marsh', 'Kettle', 'Oakes', 'Fenn', 'Gale'],
  modern: ['Hale', 'Brooks', 'Novak', 'Okafor', 'Silva', 'Reyes', 'Murphy', 'Petrov', 'Mendez'],
};

export class LeaderSystem {
  feed: Thought[] = [];
  private t = 0;
  private retorts: { f: FactionId; enemy: string; at: number }[] = [];

  constructor(private w: World) {}

  /** set up founding leaders at match start */
  init() {
    const w = this.w;
    for (const f of w.factions) {
      if (!f || f.id === NEUTRAL || f.leader) continue;
      let d: DoctrineId;
      const chosen = f.isPlayer ? w.setup.doctrine : undefined;
      if (chosen && chosen !== 'random') d = chosen;
      else if (!f.isPlayer && w.rng.next() < 0.6) d = PERSONALITY_DOCTRINE[f.personality.id] ?? 'tinkerer';
      else d = w.rng.pick(DOCTRINE_IDS);
      f.leader = {
        name: f.setup.commanderName,
        title: f.setup.commanderTitle,
        doctrine: d,
        mood: 0,
        since: 0,
        origin: 'founder',
        speakT: 4 + f.id * 2,
        museT: 40 + w.rng.next() * 40,
        trend: [],
        quirks: this.rollQuirks(),
        omenUntil: 0,
        lowT: 0,
      };
    }
  }

  private rollQuirks(): QuirkId[] {
    const w = this.w;
    const a = w.rng.pick(QUIRK_IDS);
    let b = w.rng.pick(QUIRK_IDS);
    if (b === a) b = QUIRK_IDS[(QUIRK_IDS.indexOf(a) + 3) % QUIRK_IDS.length];
    return [a, b];
  }

  /** does this realm's leader have a quirk? */
  has(f: FactionId, q: QuirkId) {
    return !!this.w.factions[f]?.leader?.quirks.includes(q);
  }

  /** combined quirk multiplier for a unit / building / research */
  quirkMul(f: FactionId, kind: 'units' | 'builds', id: string): number {
    const l = this.w.factions[f]?.leader;
    if (!l) return 1;
    let m = 1;
    for (const q of l.quirks) m *= QUIRKS[q][kind]?.[id] ?? 1;
    return m;
  }

  quirkVal(f: FactionId, key: 'research' | 'attackRatio' | 'peace'): number {
    const l = this.w.factions[f]?.leader;
    if (!l) return 1;
    let m = 1;
    for (const q of l.quirks) m *= QUIRKS[q][key] ?? 1;
    return m;
  }

  /** an omen: superstitious leaders call off new attacks for a while */
  omen(f: FactionId) {
    const l = this.w.factions[f]?.leader;
    if (!l || !l.quirks.includes('superstitious')) return false;
    l.omenUntil = this.w.time + 90;
    this.think(f, 'omen', {}, { force: true });
    return true;
  }

  doctrineOf(f: FactionId) {
    const l = this.w.factions[f]?.leader;
    return l ? DOCTRINES[l.doctrine] : null;
  }

  leaderName(f: FactionId) {
    const fac = this.w.factions[f];
    return `${fac.setup.commanderName} ${fac.setup.commanderTitle}`.trim();
  }

  // ------------------------------------------------------------------ thoughts
  /** a leader says what they are doing (throttled unless forced) */
  think(f: FactionId, kind: ThoughtKind, vars: Record<string, string> = {}, opts: { force?: boolean; x?: number; y?: number } = {}) {
    const w = this.w;
    const fac = w.factions[f];
    const l = fac?.leader;
    if (!l || !fac.alive) return;
    if (!opts.force && w.time < l.speakT) return;
    l.speakT = w.time + 9 + w.rng.next() * 8;
    let pool = DOCTRINE_LINES[l.doctrine][kind] && w.rng.next() < 0.7 ? DOCTRINE_LINES[l.doctrine][kind]! : GENERIC[kind] ?? DOCTRINE_LINES[l.doctrine][kind];
    // half of a leader's musings are about their own peculiar obsessions
    if (kind === 'muse' && l.quirks.length && w.rng.next() < 0.5) pool = QUIRKS[w.rng.pick(l.quirks)].muse[eraState.era === 'modern' ? 1 : 0];
    if (!pool?.length) return;
    const modern = eraState.era === 'modern';
    const all: Record<string, string> = {
      res: resName('gold'),
      big: modern ? 'missile' : 'great bombard',
      ...vars,
    };
    let text = w.rng.pick(pool).replace(/\{(\w+)\}/g, (_, k: string) => all[k] ?? k);
    text = text.charAt(0).toUpperCase() + text.slice(1);
    const who = this.leaderName(f);
    const th: Thought = { t: w.time, faction: f, who, text, kind, x: opts.x, y: opts.y };
    this.feed.push(th);
    if (this.feed.length > 80) this.feed.splice(0, this.feed.length - 80);
    w.events.emit('leaderThought', th);
    // the commander says it out loud if they are on the field
    const c = fac.commanderId ? w.unitById.get(fac.commanderId) : undefined;
    if (c && c.alive) w.events.emit('unitSay', { id: c.id, x: c.x, y: c.y, faction: f, text, kind: kind === 'retreat' || kind === 'mood_down' ? 'panic' : kind === 'attack' || kind === 'war' ? 'berserk' : 'normal' });
  }

  warReason() {
    return this.w.rng.pick(WAR_REASONS[eraState.era]);
  }

  // ------------------------------------------------------------------ succession
  /** the commander fell: the best soldier left standing is promoted to lead */
  onCommanderFell(f: FactionId, killer: FactionId | -1, cause: 'fell' | 'coup' = 'fell') {
    const w = this.w;
    const fac = w.factions[f];
    if (!fac || f === NEUTRAL || !fac.alive) return;
    const old = fac.leader;
    const oldName = this.leaderName(f);
    let best: Unit | null = null;
    let bs = -1;
    for (const u of w.units) {
      if (!u.alive || u.faction !== f || !u.persona || u.def.special === 'commander' || u.def.special === 'worker' || u.persona.nick) continue;
      const p = u.persona;
      const sc = p.rank * 4 + p.kills + p.rescues * 2 + (p.trait === 'coward' ? -2 : 0) + w.rng.next();
      if (sc > bs) {
        bs = sc;
        best = u;
      }
    }
    const modern = eraState.era === 'modern';
    let name: string;
    let title: string;
    let doctrine: DoctrineId;
    let origin: Leader['origin'];
    let trait = '';
    if (best?.persona) {
      const p = best.persona;
      doctrine = w.rng.pick(TRAIT_DOCTRINE[p.trait]);
      const d = DOCTRINES[doctrine];
      name = modern ? `${p.first} "${w.rng.pick(d.nick)}" ${p.last}` : `${p.first} ${p.last}`;
      title = modern ? ['Major', 'Colonel', 'General', 'Field Marshal'][Math.min(3, p.rank)] : d.epithet;
      origin = 'promoted';
      trait = p.trait;
      // they leave the line and head for the capital to take the chair
      w.despawn(best);
    } else {
      doctrine = w.rng.pick(DOCTRINE_IDS);
      const d = DOCTRINES[doctrine];
      const first = w.rng.pick(FIRST[eraState.era]);
      const last = w.rng.pick(LAST[eraState.era]);
      name = modern ? `${first} "${w.rng.pick(d.nick)}" ${last}` : `${first} ${last}`;
      title = modern ? 'General' : d.epithet;
      origin = 'appointed';
    }
    fac.setup.commanderName = name;
    fac.setup.commanderTitle = title;
    fac.leader = {
      name,
      title,
      doctrine,
      mood: Math.min(0, (old?.mood ?? 0) - 0.2),
      since: w.time,
      origin,
      speakT: 0,
      museT: w.time + 30 + w.rng.next() * 40,
      trend: old?.trend ?? [],
      quirks: this.rollQuirks(),
      omenUntil: 0,
      lowT: 0,
    };
    const d = DOCTRINES[doctrine];
    const who = `${modern && !name.includes('"') ? title + ' ' : ''}${name}${modern ? '' : ' ' + title}`.trim();
    const changed = old && old.doctrine !== doctrine;
    const q = fac.leader.quirks.map((k) => QUIRKS[k].label.toLowerCase()).join(', ');
    w.notify({
      kind: 'commander',
      text: cause === 'coup' ? `COUP IN ${fac.name.toUpperCase()}! ${who.toUpperCase()} SEIZES POWER` : `${who.toUpperCase()} TAKES COMMAND OF ${fac.name.toUpperCase()}`,
      sub: `${cause === 'coup' ? `${oldName} flees into exile` : origin === 'promoted' ? `Promoted from the ranks (${trait})` : 'Appointed in a hurry'} · ${d.label}, ${q}${changed ? ` — ${fac.isPlayer ? 'your' : 'their'} ${word('kingdom')} changes course` : ''}`,
      factions: [f, killer as FactionId],
      priority: fac.isPlayer ? 2 : 1,
      world: true,
    });
    this.think(f, cause === 'coup' ? 'coup' : 'succession', {}, { force: true });
  }

  // ------------------------------------------------------------------ mood & musings
  update(dt: number) {
    const w = this.w;
    this.t += dt;
    if (this.t < 2) return;
    const step = this.t;
    this.t = 0;
    for (const f of w.factions) {
      const l = f?.leader;
      if (!l || !f.alive || f.id === NEUTRAL) continue;
      // mood: territory trend, army strength against hostile neighbours, the capital's safety
      l.trend.push(f.territoryShare);
      if (l.trend.length > 30) l.trend.shift();
      // territory trend over the last minute
      const trend = l.trend.length > 5 ? (f.territoryShare - l.trend[0]) * 10 : 0;
      // our army against the strongest realm we are at war with
      const pow = [0, 0, 0, 0, 0];
      for (const u of w.units) if (u.alive && u.def.special !== 'worker') pow[u.faction] += u.def.power;
      let worst = 0;
      for (let k = 0; k < NEUTRAL; k++) if (k !== f.id && w.factions[k]?.alive && w.diplomacy.atWar(f.id, k as FactionId)) worst = Math.max(worst, pow[k]);
      const ratio = worst > 0 ? pow[f.id] / Math.max(4, worst) : 1.3;
      const cap = f.capitalSettlement >= 0 ? w.settlements[f.capitalSettlement] : null;
      const danger = cap && w.time - cap.lastAttackedT < 15 ? -0.35 : 0;
      const target = Math.max(-1, Math.min(1, trend + Math.log(Math.max(0.1, ratio)) * 0.5 + danger + (f.critical > 0 ? -0.6 : 0)));
      const before = l.mood;
      l.mood += (target - l.mood) * Math.min(1, step * 0.05);
      if (before < 0.5 && l.mood >= 0.5) this.think(f.id, 'mood_up');
      else if (before > -0.5 && l.mood <= -0.5) this.think(f.id, 'mood_down');
      // idle musings, insults (which are remembered) and retorts
      if (w.time > l.museT) {
        l.museT = w.time + (l.quirks.includes('sleepy') ? 80 : 45) + w.rng.next() * 60;
        const rivals = w.factions.filter((o) => o && o.id !== f.id && o.id !== NEUTRAL && o.alive);
        // insults go to whoever they already dislike, mostly
        rivals.sort((a, b) => f.grudge[b.id] + (w.diplomacy.atWar(f.id, b.id) ? 20 : 0) - (f.grudge[a.id] + (w.diplomacy.atWar(f.id, a.id) ? 20 : 0)));
        const target = rivals.length ? (w.rng.next() < 0.6 ? rivals[0] : w.rng.pick(rivals)) : null;
        if (target && w.rng.next() < 0.3) {
          this.think(f.id, 'insult', { enemy: target.name }, { force: true });
          target.grudge[f.id] = (target.grudge[f.id] ?? 0) + 6;
          this.retorts.push({ f: target.id, enemy: f.name, at: w.time + 3 + w.rng.next() * 5 });
        } else this.think(f.id, 'muse', { enemy: target?.name ?? 'the neighbours' });
      }
      // what keeps killing us: losses fade, and a clear pattern becomes a lesson
      let top = '';
      let tv = 0;
      for (const k of Object.keys(f.lossesBy)) {
        f.lossesBy[k] *= Math.pow(0.985, step);
        if (f.lossesBy[k] > tv) {
          tv = f.lossesBy[k];
          top = k;
        }
      }
      if (tv > 10 && top !== f.lesson) {
        f.lesson = top;
        const modern = eraState.era === 'modern';
        const names: Record<string, [string, string]> = {
          melee: [modern ? 'riflemen' : 'swordsmen', modern ? 'machine gunners and grenadiers' : 'archers and crossbowmen'],
          ranged: [modern ? 'gunners' : 'archers', modern ? 'riot troopers and scout cars' : 'shieldmen and cavalry'],
          cavalry: [modern ? 'vehicles' : 'horsemen', modern ? 'AT riflemen' : 'spearmen and pikemen'],
          siege: [modern ? 'artillery' : 'siege engines', modern ? 'scout cars and commandos' : 'cavalry and ballistae'],
        };
        const [them, us] = names[top] ?? ['soldiers', 'soldiers'];
        this.think(f.id, 'counter', { enemyUnit: them, unit: us }, { force: true });
      }
      // a leader desperate for too long gets overthrown
      l.lowT = l.mood < -0.75 ? l.lowT + step : Math.max(0, l.lowT - step * 2);
      const humanRun = f.isPlayer && !w.setup.realmAuto;
      if (!humanRun && l.lowT > 150 && w.time - l.since > 240 && w.rng.next() < 0.01 * step) this.coup(f.id);
    }
    // the insulted answer back
    for (const r of this.retorts) if (r.at <= w.time) this.think(r.f, 'retort', { enemy: r.enemy }, { force: true });
    this.retorts = this.retorts.filter((r) => r.at > w.time);
  }

  /** someone in the ranks has had enough of losing */
  private coup(f: FactionId) {
    const w = this.w;
    const fac = w.factions[f];
    const c = fac.commanderId ? w.unitById.get(fac.commanderId) : undefined;
    if (c && c.alive) w.despawn(c);
    fac.commanderId = 0;
    fac.commanderRespawn = 25;
    this.onCommanderFell(f, -1, 'coup');
  }
}
