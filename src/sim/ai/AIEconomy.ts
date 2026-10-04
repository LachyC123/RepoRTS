import { BUILDINGS, FORTIFY } from '../../data/buildings';
import { NEUTRAL, RES_KEYS, type Cost } from '../../data/constants';
import { UPGRADES } from '../../data/upgrades';
import { tradeRates } from '../Settlements';
import type { AIController } from './AIController';

type Cand =
  | { kind: 'build'; sid: number; plot: number; type: string; score: number; cost: Cost }
  | { kind: 'upgrade'; sid: number; score: number; cost: Cost }
  | { kind: 'fortify'; sid: number; score: number; cost: Cost }
  | { kind: 'research'; bid: number; id: string; score: number; cost: Cost }
  | { kind: 'level'; bid: number; score: number; cost: Cost };

function costTotal(c: Cost) {
  return (c.gold ?? 0) + (c.wood ?? 0) + (c.food ?? 0) + (c.stone ?? 0);
}

/**
 * AI build planning: scores every affordable-in-principle building, upgrade, fortification and
 * research, then buys the best one (or saves for it). Same rules and costs as the player.
 */
export function aiEconomy(ai: AIController) {
  const w = ai.w;
  const me = ai.id;
  const f = ai.f;
  const sys = w.settlementSys;
  const pers = ai.pers;
  const tmin = w.time / 60;
  const owned = ai.owned();
  const mine = w.buildings.filter((b) => b.faction === me && !b.destroyed);
  const count = (t: string) => mine.filter((b) => b.def.id === t).length;
  const inc = f.income;
  const cands: Cand[] = [];
  const maxTier = Math.max(0, ...owned.map((s) => s.tier));
  const military = ai.myUnits().length;

  // frontier settlements (adjacent to a hostile kingdom)
  const frontier = new Set<number>();
  for (const s of owned) for (const n of w.graph.adj[s.id]) {
    const o = w.settlements[n].owner;
    if (o !== me && o !== NEUTRAL && w.isHostile(me, o)) frontier.add(s.id);
  }

  const typeScore = (type: string, sid: number): number => {
    const s = w.settlements[sid];
    const c = count(type);
    switch (type) {
      case 'lumber_camp': {
        const want = Math.min(7, 2 + Math.floor(tmin / 3.5));
        if (c >= want && f.res.wood > 150) return 0.4;
        return (c === 0 ? 10 : 7.5 - c * 0.6) + (f.res.wood < 100 ? 2 : 0) + pers.economy * 0.5;
      }
      case 'farm': {
        const want = Math.min(8, 2 + Math.floor(tmin / 3));
        if (c >= want && f.res.food > 150) return 0.4;
        return 7.5 - c * 0.4 + (f.res.food < 100 ? 2 : 0) + pers.economy * 0.5;
      }
      case 'mine': {
        const dep = sys.nearestDeposit(s, s.region.cx, s.region.cy);
        const stone = dep?.kind === 'stone';
        if (stone) return f.res.stone > 400 ? 0.5 : (tmin > 3 ? 5 : 2) + (f.res.stone < 150 ? 2 : 0) - c * 0.3;
        return 7.5 + pers.economy * 1.5 - c * 0.3 + (f.res.gold < 150 ? 1.5 : 0);
      }
      case 'house':
        return f.popCap - f.pop <= 5 && f.popCap < 200 ? 11 : f.popCap - f.pop <= 9 ? 4.5 : 0.5;
      case 'barracks': {
        if (c === 0) return count('lumber_camp') > 0 || tmin > 1.2 ? 9 + ai.aggression * 2 : 3;
        const want = Math.min(3, 1 + Math.floor(tmin / 7));
        return c < want ? 6 + ai.aggression : 0;
      }
      case 'archery_range': {
        if (count('barracks') === 0) return 0;
        if (c === 0) return 7.5;
        return c < Math.min(2, Math.floor(tmin / 9)) ? 5 : 0;
      }
      case 'stable':
        return c === 0 && tmin > 4 ? 6.5 + ai.aggression * 2 : c < 2 && tmin > 13 ? 3 + ai.aggression * 2 : 0;
      case 'blacksmith':
        return c === 0 && tmin > 5 ? 6.5 : 0;
      case 'siege_workshop': {
        const atWar = [0, 1, 2, 3].some((k) => k !== me && w.factions[k]?.alive && w.diplomacy.stance(me, k as never) === 'war');
        return c === 0 && tmin > 5 ? (atWar ? 8 : 4) + ai.aggression * 2 : 0;
      }
      case 'chapel':
        // with living soldiers a hospital saves lives (and trains medics)
        return c === 0 && tmin > 6 ? 3 + pers.fortify * 3 + (w.living ? 2.5 : 0) : 0;
      case 'market':
        if (c === 0 && s.isCapital && tmin > 2.5) return 7.5 + pers.economy * 2;
        return c < 3 && tmin > 3 ? 3 + pers.economy * 3.5 - c * 1.5 + (c === 0 && (f.res.gold > 500 || f.res.wood > 500 || f.res.food > 500 || f.res.stone > 400) ? 5 : 0) + (inc.gold < 120 ? 1.5 : 0) : 0;
      case 'silo': {
        // only some leaders want the big gun, and only once the realm can afford to wait for it
        const keen = ai.doctrine?.silo ?? 0.8;
        return c === 0 && tmin > 12 && keen >= 0.6 ? 7 + keen * 2.5 + (f.res.gold > 400 ? 2 : 0) : 0;
      }
      case 'watchtower':
        return (frontier.has(sid) || s.isCapital) && !mine.some((b) => b.settlementId === sid && b.def.id === 'watchtower') && tmin > 4 ? pers.fortify * 5.5 + (frontier.has(sid) ? 1 : 0) : 0;
      default:
        return 0;
    }
  };
  // do other settlements have room for economy buildings? then keep the capital for military
  const roomElsewhere = owned.some((s) => !s.isCapital && s.plots.slice(0, s.unlockedPlots).some((p) => !p.buildingId));

  for (const s of owned) {
    const free: number[] = [];
    for (let i = 0; i < s.unlockedPlots; i++) if (!s.plots[i].buildingId) free.push(i);
    if (!free.length || sys.underAttack(s)) continue;
    for (const type of Object.keys(BUILDINGS)) {
      const def = BUILDINGS[type];
      if (def.system) continue;
      if (s.tier < def.tier) continue;
      if (s.region.tier === 0 && !s.isCapital && def.category !== 'economy' && type !== 'watchtower') continue;
      if (s.tier === 1 && !s.isCapital && type !== 'watchtower' && def.category !== 'economy') continue;
      let base = typeScore(type, s.id) * (ai.doctrine?.builds[type] ?? 1) * w.leaders.quirkMul(me, 'builds', type);
      if (base <= 0) continue;
      // military/civic buildings prefer safe interior settlements; economy where the resources are
      if (def.category === 'military' && frontier.has(s.id) && !s.isCapital) base *= 0.6;
      if (def.category === 'military' && s.isCapital) base *= 1.15;
      if (def.category === 'economy' && def.id !== 'market' && s.isCapital && roomElsewhere) base *= 0.75;
      // spread economy buildings: few of a kind per settlement, keep the capital for the army
      if (def.category === 'economy' && def.id !== 'market') {
        const here = mine.filter((b) => b.settlementId === s.id && b.def.id === type).length;
        const cap = s.isCapital ? (type === 'mine' ? 2 : 1) : 2;
        if (here >= cap) continue;
      }
      if ((type === 'barracks' || type === 'archery_range' || type === 'stable') && mine.some((b) => b.settlementId === s.id && b.def.id === type) && !s.isCapital) continue;
      for (const p of free) {
        if (!sys.meetsRequirement(s, p, def).ok) continue;
        // keep requirement-free plots for buildings that need them less: prefer resource plots for resource buildings
        let sc = base;
        if (def.requires === 'forest') sc *= Math.min(1.4, sys.countTrees(s.plots[p].def.x + 1.5, s.plots[p].def.y + 1.5) / 12);
        if (!def.requires && (sys.meetsRequirement(s, p, BUILDINGS.mine).ok || sys.meetsRequirement(s, p, BUILDINGS.lumber_camp).ok) && free.length < 3) sc *= 0.6;
        cands.push({ kind: 'build', sid: s.id, plot: p, type, score: sc, cost: def.cost });
        break;
      }
    }
  }
  // settlement upgrades
  for (const s of owned) {
    if (!s.canUpgrade || s.upgrading) continue;
    const cost = sys.upgradeCost(s);
    if (!cost) continue;
    let sc = 0;
    if (s.isCapital) sc = tmin > 7 ? 6.5 + pers.economy * 2 + ai.aggression : 0;
    else if (s.tier === 2) sc = tmin > 5 ? 2 + pers.expansion * 1.5 + pers.economy * 2 + (s.unlockedPlots - s.plots.filter((p) => p.buildingId).length === 0 ? 2.5 : 0) : 0;
    else if (s.tier === 3) sc = tmin > 10 ? 2 + pers.economy * 1.5 + pers.fortify : 0;
    if (frontier.has(s.id) && !s.isCapital) sc *= 0.7;
    if (sc > 0) cands.push({ kind: 'upgrade', sid: s.id, score: sc, cost });
  }
  // fortifications
  for (const s of owned) {
    const next = FORTIFY.find((x) => x.level === s.fortify + 1);
    if (!next || s.fortifying || s.tier < next.minTier) continue;
    let sc = 0;
    if (s.isCapital) sc = tmin > 6 ? pers.fortify * 6 + (frontier.size > 0 ? 1.5 : 0) : 0;
    else if (frontier.has(s.id) && s.tier >= 3) sc = tmin > 9 ? pers.fortify * 4 : 0;
    if (ai.intel.threatAt(s.id) > 3) sc += 2;
    if (sc > 0.8) cands.push({ kind: 'fortify', sid: s.id, score: sc, cost: next.cost });
  }
  // research
  for (const b of mine) {
    if (!b.active || !b.def.researches || b.research) continue;
    for (const id of b.def.researches) {
      if (!sys.canResearch(me, b.id, id).ok && !f.upgrades.has(id)) {
        // unaffordable is fine (we may save), other reasons skip
        const r = sys.canResearch(me, b.id, id);
        if (r.reason !== 'Not enough resources') continue;
      }
      if (f.upgrades.has(id)) continue;
      const up = UPGRADES[id];
      let sc = military > 10 ? 4.5 + (tmin > 10 ? 1.5 : 0) + (f.res.gold > 300 ? 1 : 0) : 1;
      if (id === 'fletching' && ai.myUnits().filter((u) => u.isRanged).length < 4) sc -= 1.5;
      if (id === 'barding' && ai.myUnits().filter((u) => u.def.tags.includes('cavalry')).length < 4) sc -= 2;
      if (up.at === 'chapel') sc += pers.fortify - 0.5;
      sc *= (ai.doctrine?.research ?? 1) * w.leaders.quirkVal(me, 'research');
      if (sc > 0) cands.push({ kind: 'research', bid: b.id, id, score: sc, cost: up.cost });
    }
  }

  // building efficiency upgrades: busy economy first, then training halls and towers
  // (spending surplus only, one at a time)
  if (tmin > 7 && !mine.some((b) => b.levelUpT > 0)) {
    const tycoon = ai.doctrine?.id === 'tycoon' ? 1.4 : 1;
    for (const b of mine) {
      if (!b.active || b.levelUpT > 0 || !sys.levelable(b) || b.level >= 3) continue;
      const cost = sys.levelCost(b);
      if (!cost) continue;
      if (!RES_KEYS.every((k) => (cost[k] ?? 0) * 1.6 <= f.res[k])) continue;
      if (!sys.canLevelUp(me, b.id).ok) continue;
      const c = b.def.category;
      let sc = c === 'economy' ? 2 + pers.economy * 2.5 * b.staffed : c === 'military' ? 1.2 + ai.aggression * 1.2 : b.def.id === 'watchtower' ? pers.fortify * 2.5 : 1.2;
      if (b.def.id === 'house') sc = f.popCap - f.pop < 8 && f.popCap < 200 ? 3.5 : 0.5;
      sc *= tycoon * (ai.doctrine?.builds[b.def.id] ?? 1) * (b.level === 2 ? 0.75 : 1);
      if (sc > 1) cands.push({ kind: 'level', bid: b.id, score: sc, cost });
    }
  }

  // trade: surplus gold buys the scarcest good; surplus goods are sold for gold
  if (sys.canTrade(me)) {
    const goods = ['food', 'wood', 'stone'] as const;
    const scarce = goods.slice().sort((a, b) => f.res[a] - f.res[b])[0];
    const rich = goods.slice().sort((a, b) => f.res[b] - f.res[a])[0];
    const markets = sys.marketCount(me);
    if (f.res.gold > (markets ? 450 : 600) && f.res[scarce] < 200) sys.trade(me, scarce, true);
    // starving for one good (lost its forests or farms): pay whatever it costs
    else if (f.res[scarce] < 60 && f.res.gold > tradeRates(markets).buy + 60) sys.trade(me, scarce, true);
    else if (f.res.gold < 250 && f.res[rich] > 400) {
      sys.trade(me, rich, false);
      if (f.res[rich] > 700) sys.trade(me, rich, false);
      if (f.res[rich] > 1100) sys.trade(me, rich, false);
    }
  }
  ai.savingEcon = false;
  if (!cands.length) {
    ai.savingFor = null;
    return;
  }
  cands.sort((a, b) => b.score - a.score);
  // imperfect AIs sometimes pick from the top three
  let choice = cands[0];
  if (ai.w.rng.next() > ai.diff.efficiency && cands.length > 2) choice = cands[Math.floor(ai.w.rng.next() * 3)];
  const afford = RES_KEYS.every((k) => (choice.cost[k] ?? 0) <= f.res[k]);
  ai.debug.econ = `${choice.kind}:${'type' in choice ? choice.type : 'id' in choice ? choice.id : 'sid' in choice ? w.settlements[choice.sid].name : 'b' + choice.bid} ${choice.score.toFixed(1)}${afford ? '' : ' (saving)'}`;
  if (afford) {
    let ok = false;
    if (choice.kind === 'build') ok = sys.build(me, choice.sid, choice.plot, choice.type).ok;
    else if (choice.kind === 'upgrade') ok = sys.upgrade(me, choice.sid).ok;
    else if (choice.kind === 'fortify') ok = sys.fortifyCmd(me, choice.sid).ok;
    else if (choice.kind === 'level') ok = sys.levelUp(me, choice.bid).ok;
    else ok = sys.research(me, choice.bid, choice.id).ok;
    if (ok) narrate(ai, choice);
    if (ok) {
      ai.debug.lastBuild = ai.debug.econ;
      ai.savingFor = null;
      // cheap secondary purchase in the same think
      const second = cands.find((c) => c !== choice && c.kind === 'build' && costTotal(c.cost) < 90 && c.score > 4 && RES_KEYS.every((k) => (c.cost[k] ?? 0) <= f.res[k]));
      if (second && second.kind === 'build') sys.build(me, second.sid, second.plot, second.type);
    }
  } else {
    // only save for things we can afford soon; otherwise let other spending continue
    let minutes = 0;
    for (const k of RES_KEYS) {
      const deficit = (choice.cost[k] ?? 0) - f.res[k];
      if (deficit > 0) minutes = Math.max(minutes, deficit / Math.max(1, inc[k]));
    }
    const key = JSON.stringify(choice.cost) + ('type' in choice ? choice.type : choice.kind);
    if (ai.saveKey !== key) {
      ai.saveKey = key;
      ai.saveSince = w.time;
    }
    // save for up to 70s, take a 25s break (so the army isn't starved), then save again
    const cycle = (w.time - ai.saveSince) % 95;
    const patience = cycle < 70;
    // the big gun is worth saving up for
    const bigBuy = choice.kind === 'build' && choice.type === 'silo';
    ai.savingFor = choice.score >= 6 && minutes < (bigBuy ? 5 : 2.5) && patience ? JSON.stringify(choice.cost) : null;
    ai.savingEcon = !!ai.savingFor && choice.kind === 'build' && (BUILDINGS[choice.type].category === 'economy' || choice.type === 'house');
    if (!ai.savingFor) {
      // buy the best thing we *can* afford instead
      const alt = cands.find((c) => c !== choice && c.score > 3 && RES_KEYS.every((k) => (c.cost[k] ?? 0) <= f.res[k]));
      if (alt) {
        let ok = false;
        if (alt.kind === 'build') ok = sys.build(me, alt.sid, alt.plot, alt.type).ok;
        else if (alt.kind === 'upgrade') ok = sys.upgrade(me, alt.sid).ok;
        else if (alt.kind === 'fortify') ok = sys.fortifyCmd(me, alt.sid).ok;
        else if (alt.kind === 'level') ok = sys.levelUp(me, alt.bid).ok;
        else ok = sys.research(me, alt.bid, alt.id).ok;
        if (ok) narrate(ai, alt);
        if (ok) ai.debug.lastBuild = `${alt.kind}:${'type' in alt ? alt.type : ''}`;
      }
    }
  }
}

/** the leader mentions the bigger purchases */
function narrate(ai: AIController, c: Cand) {
  const w = ai.w;
  if (ai.autopilot || w.rng.next() > 0.35) return;
  if (c.kind === 'build') {
    const def = BUILDINGS[c.type];
    if (def.category === 'economy' && w.rng.next() < 0.5 && c.type !== 'market') return;
    w.leaders.think(ai.id, 'build', { thing: def.name.toLowerCase(), target: w.settlements[c.sid].name });
  } else if (c.kind === 'research') w.leaders.think(ai.id, 'research', { thing: UPGRADES[c.id].name });
  else if (c.kind === 'level') {
    const b = w.buildingById.get(c.bid);
    if (b) w.leaders.think(ai.id, 'build', { thing: `better ${b.def.name.toLowerCase()}`, target: w.settlements[b.settlementId].name });
  } else if (c.kind === 'upgrade') w.leaders.think(ai.id, 'build', { thing: 'bigger town', target: w.settlements[c.sid].name });
}
