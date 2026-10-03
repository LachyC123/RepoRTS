/**
 * Master palette. Every procedural sprite pulls from these ramps so the whole game shares one
 * pixel-art language: warm light from the top-left, cool purple-black shadows, selective outlines.
 * Ramps go dark → light.
 */
export const OUTLINE = '#1b1420';

export const RAMP = {
  grass: ['#284d26', '#33602b', '#3f7231', '#4d8537', '#5e963e', '#74a94a', '#8cbc58'],
  meadow: ['#47702e', '#578236', '#69953e', '#7da647', '#93b752', '#abc862'],
  forest: ['#1c3320', '#223d22', '#2a4726', '#33532b', '#3e6031'],
  hill: ['#3f5428', '#4c6430', '#5b7437', '#6b843f', '#7f9649', '#95a856'],
  dirt: ['#4f3a28', '#634a32', '#78593b', '#8d6b47', '#a27f55', '#b69466'],
  road: ['#6a563d', '#7f694b', '#94805c', '#a9946c', '#bea97f', '#d0bd93'],
  sand: ['#94804f', '#a99361', '#bea773', '#d1bb88', '#e1cd9e'],
  rock: ['#2e2a33', '#3d3842', '#4d4752', '#5e5763', '#716a76', '#867f8a', '#9e97a1', '#bab4bc'],
  snow: ['#a8b0c0', '#c8d0dc', '#e4ecf2'],
  water: ['#16294c', '#1b335e', '#213e70', '#284a82', '#305894', '#3b68a4', '#4a7bb4', '#5d90c2', '#78a8d0'],
  foam: '#cfe6ee',
  shallow: ['#3f7aa0', '#4f8cb0', '#65a0bf', '#80b6cc'],
  marsh: ['#2c4630', '#36533a', '#416042', '#4e6e4a'],
  wheat: ['#8a6d2a', '#a78636', '#c29f43', '#d8b656', '#e8cb70'],
  crops: ['#3c6428', '#4a762e', '#5a8936', '#6e9c40'],
  plowed: ['#4a3324', '#5a3f2b', '#6b4c33', '#7e5b3d'],
  flax: ['#4b6b5e', '#5a7d6c', '#6f917e', '#89a891'],
  wood: ['#2e1e14', '#43291a', '#5a3822', '#71492c', '#8a5d38', '#a57446', '#bf8d58'],
  thatch: ['#5e4320', '#7a5a2a', '#957033', '#b0883e', '#c9a04c', '#ddb963'],
  tile: ['#4a1c1a', '#64261f', '#7e3226', '#98402e', '#b05238', '#c66a47'],
  slate: ['#24283a', '#30364a', '#3e455b', '#4e566d', '#626b82'],
  stone: ['#3c3842', '#4e4954', '#625c67', '#77717c', '#8e8892', '#a7a1aa', '#c0bac2'],
  plaster: ['#9c8c70', '#b4a486', '#cbbd9f', '#ded3b8', '#ece4cf'],
  skin: ['#6a3e2a', '#8e5a40', '#b47a58', '#d49c76', '#e8b890'],
  metal: ['#2c3038', '#41464f', '#5a606b', '#767d89', '#959ca8', '#b8bec8', '#dde2e8'],
  goldm: ['#6a4c14', '#946c20', '#bd922e', '#ddb648', '#f1d97a'],
  leather: ['#3a2618', '#4f3420', '#66452b', '#7d5735', '#966b42'],
  cloth: ['#3e3a30', '#524c3e', '#67604e', '#7d7560'],
  hay: ['#8a6a24', '#a8862f', '#c4a23e', '#dcbd58'],
  fire: ['#5a1a10', '#a2301a', '#e0581e', '#f8902a', '#ffc548', '#fff0a0'],
  smoke: ['#3a3640', '#55505a', '#77727c', '#9a95a0', '#bdb8c2'],
  // ---- modern era (appended)
  /** poured concrete, faintly warm so it sits with the earthy terrain */
  concrete: ['#3e3c40', '#504e50', '#646160', '#7a7672', '#908b84', '#a7a198', '#bdb7ac', '#d3cdc0'],
  /** galvanised corrugated sheet */
  corrugated: ['#363c46', '#4a525c', '#5f6872', '#77808a', '#909aa2', '#aab3b8', '#c6ccce'],
  rust: ['#3a1c14', '#55291a', '#723820', '#8e4a26', '#aa602e', '#c27a3c'],
  brick: ['#3a1a18', '#52221c', '#6c2c22', '#843828', '#9c4630', '#b2583a', '#c46e4c'],
  asphalt: ['#232226', '#2c2a2f', '#353339', '#3f3c43', '#4a474e', '#57535a'],
  olive: ['#22261a', '#2f3520', '#3e4528', '#4e5630', '#5f683a', '#737c46', '#899255'],
  camo: ['#2a3420', '#3a4628', '#4c5830', '#5e6a38', '#6e7444'],
  tarp: ['#1c3226', '#24402e', '#2e5038', '#3a6244', '#487452'],
  sandbag: ['#4e4230', '#665640', '#7e6c50', '#968462', '#ac9a74', '#c2b08a'],
  white: ['#6c7078', '#8a8e94', '#a8acae', '#c4c6c4', '#dcdcd6', '#eeece4'],
  hazard: ['#1c1a1e', '#e0b028'],
};

export function ramp(name: keyof typeof RAMP): string[] {
  return RAMP[name] as string[];
}

/** 4×4 Bayer matrix normalised to [-0.5, 0.5) for ordered dithering */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

export function pickRamp(r: string[], v: number, x: number, y: number, dither = 1): string {
  const n = r.length;
  let f = v * (n - 1) + BAYER4[(x & 3) + ((y & 3) << 2)] * dither;
  let i = Math.round(f);
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  return r[i];
}

/** Modern-era military ramps (dark → light): uniforms, vehicles, brass. */
export const MIL = {
  olive: ['#262a1a', '#353a22', '#454b2c', '#576036', '#6b7442', '#838c54'],
  drab: ['#2e2a1e', '#3e3826', '#524a32', '#675d3e', '#7e724e', '#978a62'],
  khaki: ['#5a4e36', '#706244', '#887856', '#a08f68', '#b8a67e', '#cebe96'],
  camo: ['#2a2a1c', '#3c3e26', '#545a34', '#6a5a3a', '#7a7e4a'],
  grey: ['#25282c', '#33373c', '#454a50', '#5a6067', '#737a82', '#9097a0'],
  steel: ['#1e2024', '#2c2f34', '#3c4046', '#50555c'],
  rubber: ['#141418', '#1e1e24', '#2a2a32', '#3a3a44'],
  brass: ['#7a5418', '#a8781e', '#d0a438', '#f0d070'],
  denim: ['#1e2a44', '#2a3a5a', '#3a4e74', '#50668e'],
  char: ['#140f12', '#1e1719', '#2a2124', '#3a2e2e'],
  glass: ['#4a6a7a', '#7aa0b4', '#b4d4e4'],
};
