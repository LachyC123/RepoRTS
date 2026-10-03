/**
 * CROWNSHIRE VALLEY — the handcrafted first map.
 * Coordinates are in tiles on a 160×160 grid. The generator (sim/map/MapGen.ts) turns this
 * description into terrain, regions, roads and settlements; small seeded variation is applied
 * to decoration only so the strategic layout is always the same.
 */
export type Feature = 'forest' | 'farmland' | 'gold' | 'stone' | 'river' | 'crossroads' | 'fortress' | 'ruins' | 'hills' | 'holy';
export type LandmarkKind =
  | 'woodcutter'
  | 'shrine'
  | 'tower'
  | 'crossroads'
  | 'mine'
  | 'quarry'
  | 'ruins'
  | 'fort'
  | 'abbey'
  | 'stones'
  | 'camp'
  | 'graveyard'
  | 'lodge'
  | 'plague'
  | 'burned';

export interface RegionSeedDef {
  name: string;
  x: number;
  y: number;
  /** 0 landmark, 1 outpost, 2 village, 3 town, 4 castle town */
  tier: number;
  capital?: 0 | 1 | 2 | 3;
  features: Feature[];
  landmark?: LandmarkKind;
  garrison?: [string, number][];
  /** strategic importance multiplier for AI (1 = normal) */
  value?: number;
  /** flavour line shown when selected */
  lore?: string;
  /** voronoi weight: >1 grows the region */
  weight?: number;
}

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  regions: RegionSeedDef[];
  rivers: { points: [number, number][]; width: number }[];
  lakes: { x: number; y: number; rx: number; ry: number }[];
  ridges: { points: [number, number][]; radius: number }[];
  /** gaps cut through ridges */
  passes: { x: number; y: number; r: number }[];
  crossings: { x: number; y: number; kind: 'bridge' | 'ford'; name: string }[];
  roads: [string, string][];
  story: { kind: StoryKind; x: number; y: number }[];
  /** camera tour for the intro cinematic */
  tour: string[];
}

export type StoryKind =
  | 'battlefield'
  | 'plague_village'
  | 'collapsed_bridge'
  | 'old_tower'
  | 'burned_farm'
  | 'graveyard'
  | 'stone_circle'
  | 'castle_ruin'
  | 'bandit_camp'
  | 'windmill'
  | 'shipwreck';

export const CROWNSHIRE: MapDef = {
  id: 'crownshire',
  name: 'Crownshire Valley',
  width: 160,
  height: 160,
  regions: [
    // ---------- West kingdom ----------
    { name: 'Westhaven', x: 18, y: 84, tier: 3, capital: 0, features: ['forest', 'gold', 'stone'], lore: 'A walled market town on the western downs.', weight: 1.25 },
    { name: 'Greyfield', x: 35, y: 73, tier: 2, features: ['farmland'], garrison: [['rebel', 2]], lore: 'Barley fields and a stubborn reeve.' },
    { name: 'Ashwood', x: 13, y: 63, tier: 0, landmark: 'woodcutter', features: ['forest'], garrison: [['wolf', 2]], lore: 'Old ash and oak, thick with wolves.' },
    { name: 'Millbrook', x: 17, y: 106, tier: 2, features: ['farmland', 'river'], garrison: [['rebel', 3]], lore: 'A mill turns on the brook.' },
    { name: 'Oakhaven', x: 37, y: 95, tier: 2, features: ['forest'], garrison: [['rebel', 3]], lore: 'Woodsfolk and charcoal burners.' },
    { name: 'Westwatch', x: 11, y: 43, tier: 1, landmark: 'tower', features: ['hills', 'stone'], garrison: [['deserter', 2]], lore: 'A lonely watchtower over the western hills.' },
    // ---------- North kingdom ----------
    { name: 'Highmere', x: 79, y: 18, tier: 3, capital: 1, features: ['forest', 'gold', 'stone', 'river'], lore: 'A lakeside hall beneath the pines.', weight: 1.25 },
    { name: 'Wolfpine', x: 99, y: 12, tier: 0, landmark: 'lodge', features: ['forest'], garrison: [['wolf', 3]], lore: 'Dark pinewoods where the wolves howl.' },
    { name: 'Elkmoor', x: 60, y: 34, tier: 2, features: ['farmland'], garrison: [['rebel', 2]], lore: 'Moorland pastures and peat smoke.' },
    { name: 'Coldbrook', x: 92, y: 33, tier: 2, features: ['farmland', 'river'], garrison: [['rebel', 3]], lore: 'A cold stream feeds the Redwater.' },
    { name: 'Northpass', x: 31, y: 30, tier: 1, landmark: 'tower', features: ['hills'], garrison: [['deserter', 3]], value: 1.3, lore: 'The only pass through the Greyspine.' },
    { name: 'Blackstone Quarry', x: 50, y: 13, tier: 0, landmark: 'quarry', features: ['stone', 'hills'], garrison: [['bandit', 2]], value: 1.2, lore: 'Black granite, prized by masons.' },
    // ---------- North-east (east bank) ----------
    { name: "Stag's Rest", x: 131, y: 13, tier: 0, landmark: 'lodge', features: ['forest'], garrison: [['wolf', 2]], lore: 'A royal hunting lodge, long abandoned.' },
    { name: 'Goldcrest Mine', x: 141, y: 31, tier: 0, landmark: 'mine', features: ['gold', 'hills'], garrison: [['bandit', 3], ['bandit_archer', 1]], value: 1.5, lore: 'The richest gold seam in Crownshire.' },
    { name: 'Dawnridge', x: 153, y: 45, tier: 0, landmark: 'quarry', features: ['stone', 'hills'], garrison: [['bandit', 2]], lore: 'Pale stone catches the sunrise.' },
    { name: 'Hollowmere', x: 119, y: 32, tier: 2, landmark: 'plague', features: ['ruins'], garrison: [['deserter', 2]], lore: 'Emptied by plague. Some say it is cursed.' },
    // ---------- East kingdom ----------
    { name: 'Eastwold', x: 142, y: 80, tier: 3, capital: 2, features: ['forest', 'gold', 'stone'], lore: 'Timber halls among rolling wolds.', weight: 1.25 },
    { name: 'Greenfield', x: 127, y: 65, tier: 2, features: ['farmland'], garrison: [['rebel', 2]], lore: 'Green meadows and fat sheep.' },
    { name: 'Hartwood', x: 152, y: 61, tier: 0, landmark: 'woodcutter', features: ['forest'], garrison: [['wolf', 2]], lore: 'Deep oakwood of the east.' },
    { name: 'Brightwater', x: 129, y: 98, tier: 2, features: ['river', 'farmland'], garrison: [['rebel', 3]], lore: 'Fishermen and willow weavers.' },
    { name: 'Oakwatch', x: 151, y: 104, tier: 1, landmark: 'tower', features: ['forest'], garrison: [['deserter', 2]], lore: 'A watchtower in the oaks.' },
    { name: 'Redwater', x: 114, y: 50, tier: 2, features: ['river', 'farmland'], garrison: [['rebel', 3]], value: 1.2, lore: 'The river runs red with iron clay.' },
    // ---------- South kingdom ----------
    { name: 'Thornbury', x: 85, y: 143, tier: 3, capital: 3, features: ['forest', 'gold', 'stone'], lore: 'A hedged burh on the southern march.', weight: 1.25 },
    { name: 'Briarvale', x: 104, y: 134, tier: 2, features: ['farmland'], garrison: [['rebel', 2]], lore: 'Orchards and bramble hedges.' },
    { name: 'Fenwick', x: 77, y: 124, tier: 2, features: ['farmland', 'river'], garrison: [['rebel', 3]], lore: 'Reed beds along the river.' },
    { name: 'Mossbank', x: 106, y: 153, tier: 0, landmark: 'woodcutter', features: ['forest'], garrison: [['wolf', 2]], lore: 'Mossy woods to the south.' },
    { name: 'Southwatch', x: 125, y: 146, tier: 1, landmark: 'tower', features: ['hills'], garrison: [['deserter', 2]], lore: 'Watching the southern road.' },
    { name: 'Whitestone', x: 147, y: 141, tier: 0, landmark: 'quarry', features: ['stone'], garrison: [['bandit', 2]], lore: 'Chalk and whitestone pits.' },
    { name: 'Duskfort', x: 134, y: 123, tier: 1, landmark: 'fort', features: ['fortress', 'ruins'], garrison: [['deserter', 4], ['bandit_archer', 2]], value: 1.3, lore: 'An abandoned fort held by deserters.' },
    { name: 'Bramblewood', x: 116, y: 115, tier: 0, landmark: 'woodcutter', features: ['forest'], garrison: [['wolf', 3]], lore: 'Thorny thickets and hidden paths.' },
    // ---------- Central ring ----------
    { name: 'Crownkeep', x: 81, y: 81, tier: 4, landmark: 'fort', features: ['fortress', 'river'], garrison: [['garrison_guard', 6], ['garrison_archer', 6]], value: 2.5, lore: 'The old royal fortress. Whoever holds it, holds the valley.', weight: 0.8 },
    { name: 'Crown Hill', x: 61, y: 78, tier: 1, landmark: 'tower', features: ['hills'], garrison: [['deserter', 3]], value: 1.3, lore: 'A hilltop tower overlooking the keep.' },
    { name: 'Gallows Cross', x: 50, y: 61, tier: 0, landmark: 'crossroads', features: ['crossroads'], garrison: [['bandit', 3]], value: 1.2, lore: 'Four roads meet beneath an old gibbet.' },
    { name: 'Ember Fields', x: 43, y: 46, tier: 2, landmark: 'burned', features: ['farmland', 'ruins'], garrison: [['bandit', 3]], lore: 'Burned in the last war. Fields still fertile.' },
    { name: 'Ravenmoor', x: 70, y: 53, tier: 0, landmark: 'ruins', features: ['ruins', 'gold'], garrison: [['deserter', 3]], value: 1.2, lore: 'A forgotten castle ruin. Ravens nest in the towers.' },
    { name: 'Stonebridge', x: 99, y: 48, tier: 2, features: ['river', 'crossroads'], garrison: [['rebel', 3]], value: 1.4, lore: 'The great stone bridge over the Redwater.' },
    { name: 'Fallow Down', x: 106, y: 79, tier: 0, landmark: 'stones', features: ['hills', 'holy'], garrison: [['bandit', 2]], lore: 'A ring of standing stones on the downs.' },
    { name: 'Old Abbey', x: 101, y: 103, tier: 1, landmark: 'abbey', features: ['holy', 'farmland'], garrison: [['rebel', 3]], value: 1.1, lore: 'Monks still ring the bell at dusk.' },
    { name: 'Kingsford', x: 83, y: 108, tier: 2, features: ['river', 'crossroads'], garrison: [['rebel', 3]], value: 1.3, lore: 'Kings once forded the river here.' },
    { name: 'Willowmere', x: 61, y: 99, tier: 2, features: ['river', 'farmland'], garrison: [['rebel', 2]], lore: 'Willows lean over quiet water.' },
    { name: 'Mistvale', x: 45, y: 115, tier: 2, features: ['farmland'], garrison: [['rebel', 3]], lore: 'Morning mist pools in the vale.' },
    { name: 'Iron Hollow', x: 28, y: 129, tier: 0, landmark: 'mine', features: ['gold', 'hills'], garrison: [['bandit', 3], ['bandit_archer', 1]], value: 1.5, lore: 'An iron-and-gold mine in the southern crags.' },
    { name: "Bandit's Hollow", x: 13, y: 146, tier: 0, landmark: 'camp', features: ['forest'], garrison: [['bandit', 4], ['bandit_archer', 2]], lore: 'The bandit lord of Crownshire keeps his camp here.' },
    { name: 'Barrow Hill', x: 46, y: 140, tier: 0, landmark: 'graveyard', features: ['holy', 'hills'], garrison: [['deserter', 2]], lore: 'Barrows of forgotten kings.' },
    { name: 'Rookwood', x: 66, y: 150, tier: 0, landmark: 'woodcutter', features: ['forest'], garrison: [['wolf', 2]], lore: 'Rooks circle over the beeches.' },
  ],
  rivers: [
    {
      // The Redwater: from the north-east down to the south, splitting around Crownkeep island.
      points: [
        [121, -2], [116, 10], [111, 22], [105, 34], [101, 44], [97, 56], [92, 65],
        [86, 68], [76, 68], [69, 74], [68, 84], [72, 93], [79, 98],
        [77, 106], [72, 116], [68, 126], [64, 136], [62, 148], [61, 162],
      ],
      width: 2.6,
    },
    {
      // east channel round Crownkeep island
      points: [[92, 65], [95, 72], [95, 82], [91, 92], [84, 97], [79, 98]],
      width: 2.2,
    },
    {
      // Mill stream feeding Millbrook
      points: [[-2, 112], [10, 109], [22, 110], [33, 106], [44, 104], [55, 100], [66, 94], [69, 88]],
      width: 1.3,
    },
    {
      // Coldbrook stream from the lake
      points: [[70, 24], [80, 28], [88, 31], [97, 38], [102, 42]],
      width: 1.2,
    },
    {
      // Brightwater stream
      points: [[162, 92], [150, 94], [138, 97], [126, 100], [112, 98], [100, 94], [94, 86]],
      width: 1.3,
    },
  ],
  lakes: [
    { x: 64, y: 21, rx: 7, ry: 4.5 },
    { x: 134, y: 112, rx: 4, ry: 2.6 },
  ],
  ridges: [
    // Greyspine (north-west corner)
    { points: [[-4, 38], [10, 34], [20, 26], [28, 20], [36, 14], [42, 4], [44, -4]], radius: 6.5 },
    { points: [[-2, 26], [12, 14], [24, 4]], radius: 8 },
    // eastern crags around Goldcrest
    { points: [[150, -4], [148, 10], [154, 22], [164, 30]], radius: 6 },
    { points: [[128, 26], [134, 36], [146, 40], [158, 36]], radius: 2.6 },
    // southern crags around Iron Hollow
    { points: [[-4, 124], [8, 122], [18, 120], [24, 116]], radius: 4.5 },
    { points: [[34, 136], [36, 146], [30, 160]], radius: 4 },
    { points: [[16, 134], [20, 140]], radius: 3 },
    // south-east hills
    { points: [[160, 124], [154, 128], [150, 134]], radius: 4 },
    // small hills
    { points: [[56, 72], [58, 70]], radius: 2.5 },
    { points: [[108, 74], [110, 70]], radius: 2 },
  ],
  passes: [
    { x: 30, y: 26, r: 4 },
    { x: 22, y: 30, r: 3 },
    { x: 38, y: 22, r: 3 },
    { x: 140, y: 38, r: 3.5 },
    { x: 26, y: 125, r: 3 },
    { x: 152, y: 18, r: 3 },
    { x: 18, y: 125, r: 3 },
  ],
  crossings: [
    { x: 116, y: 11, kind: 'ford', name: 'Wolfpine Ford' },
    { x: 101, y: 45, kind: 'bridge', name: 'Stonebridge' },
    { x: 69, y: 80, kind: 'bridge', name: 'West Crown Bridge' },
    { x: 94, y: 78, kind: 'bridge', name: 'East Crown Bridge' },
    { x: 76, y: 105, kind: 'ford', name: 'Kingsford' },
    { x: 66, y: 131, kind: 'bridge', name: 'Fenwick Bridge' },
    { x: 89, y: 66, kind: 'bridge', name: 'North Crown Bridge' },
    { x: 62, y: 154, kind: 'ford', name: 'Rook Ford' },
  ],
  roads: [
    // west
    ['Westhaven', 'Greyfield'], ['Westhaven', 'Ashwood'], ['Westhaven', 'Millbrook'], ['Westhaven', 'Oakhaven'],
    ['Ashwood', 'Westwatch'], ['Westwatch', 'Northpass'], ['Greyfield', 'Gallows Cross'], ['Greyfield', 'Crown Hill'],
    ['Oakhaven', 'Willowmere'], ['Oakhaven', 'Mistvale'], ['Millbrook', 'Mistvale'], ['Mistvale', 'Iron Hollow'],
    ['Mistvale', 'Barrow Hill'], ['Iron Hollow', "Bandit's Hollow"], ['Greyfield', 'Ember Fields'],
    // north
    ['Highmere', 'Elkmoor'], ['Highmere', 'Wolfpine'], ['Highmere', 'Coldbrook'], ['Highmere', 'Blackstone Quarry'],
    ['Elkmoor', 'Ember Fields'], ['Elkmoor', 'Ravenmoor'], ['Northpass', 'Ember Fields'], ['Northpass', 'Blackstone Quarry'],
    ['Coldbrook', 'Stonebridge'], ['Ravenmoor', 'Stonebridge'], ['Ember Fields', 'Gallows Cross'], ['Gallows Cross', 'Ravenmoor'],
    ['Wolfpine', "Stag's Rest"],
    // centre
    ['Crown Hill', 'Crownkeep'], ['Crownkeep', 'Fallow Down'], ['Ravenmoor', 'Crownkeep'], ['Crownkeep', 'Kingsford'],
    ['Willowmere', 'Kingsford'], ['Willowmere', 'Crown Hill'],
    // east
    ['Eastwold', 'Greenfield'], ['Eastwold', 'Hartwood'], ['Eastwold', 'Brightwater'], ['Eastwold', 'Oakwatch'],
    ['Greenfield', 'Redwater'], ['Redwater', 'Stonebridge'], ['Redwater', 'Hollowmere'], ['Hollowmere', 'Goldcrest Mine'],
    ['Hollowmere', "Stag's Rest"], ['Goldcrest Mine', 'Dawnridge'], ['Dawnridge', 'Hartwood'], ['Greenfield', 'Fallow Down'],
    ['Brightwater', 'Old Abbey'], ['Brightwater', 'Duskfort'], ['Oakwatch', 'Duskfort'],
    // south
    ['Thornbury', 'Briarvale'], ['Thornbury', 'Fenwick'], ['Thornbury', 'Mossbank'], ['Thornbury', 'Rookwood'],
    ['Briarvale', 'Southwatch'], ['Southwatch', 'Whitestone'], ['Whitestone', 'Duskfort'], ['Briarvale', 'Bramblewood'],
    ['Bramblewood', 'Old Abbey'], ['Bramblewood', 'Duskfort'], ['Old Abbey', 'Kingsford'], ['Fenwick', 'Kingsford'],
    ['Fenwick', 'Mistvale'], ['Rookwood', 'Barrow Hill'], ['Old Abbey', 'Fallow Down'],
  ],
  story: [
    { kind: 'battlefield', x: 88, y: 58 },
    { kind: 'plague_village', x: 121, y: 35 },
    { kind: 'collapsed_bridge', x: 104, y: 38 },
    { kind: 'old_tower', x: 41, y: 83 },
    { kind: 'burned_farm', x: 46, y: 49 },
    { kind: 'graveyard', x: 49, y: 143 },
    { kind: 'stone_circle', x: 109, y: 82 },
    { kind: 'castle_ruin', x: 73, y: 50 },
    { kind: 'bandit_camp', x: 15, y: 148 },
    { kind: 'windmill', x: 21, y: 101 },
    { kind: 'windmill', x: 108, y: 131 },
    { kind: 'windmill', x: 124, y: 62 },
    { kind: 'windmill', x: 57, y: 37 },
    { kind: 'battlefield', x: 58, y: 112 },
  ],
  tour: ['Crownkeep', 'Stonebridge', 'Goldcrest Mine', 'Duskfort', 'Iron Hollow', 'Northpass'],
};
