import type { CrestId, KingdomColor } from '../data/factions';
import { PixelCanvas, shade } from '../render/art/PixelCanvas';
import { OUTLINE, RAMP } from '../render/art/palette';

/** Hand-pixelled heraldic charges, 13×13. '#' = charge colour, '+' = shadow tone. */
const CHARGES: Record<CrestId, string[]> = {
  lion: [
    '.....###.....',
    '....#####....',
    '...###.##....',
    '...######....',
    '....####.....',
    '...######..#.',
    '..########.#.',
    '.#########.#.',
    '.###.####.##.',
    '.##..#####...',
    '.#...##.##...',
    '.##..##..##..',
    '.............',
  ],
  wolf: [
    '..#.....#....',
    '..##...##....',
    '..#######....',
    '..##.#.##....',
    '..#######....',
    '...#####.....',
    '...##.###....',
    '..#########..',
    '.###########.',
    '.##.#####.##.',
    '.#..##..##.#.',
    '....#....#...',
    '.............',
  ],
  stag: [
    '.#.#...#.#...',
    '.#.#...#.#...',
    '..###.###....',
    '...#...#.....',
    '....###......',
    '....#.#......',
    '....###......',
    '...#####.....',
    '..#######....',
    '..##.####....',
    '..#...#.#....',
    '..#...#.#....',
    '.............',
  ],
  boar: [
    '.............',
    '.............',
    '...#######...',
    '..#########..',
    '.##.########.',
    '###########.#',
    '.#+#########.',
    '..##########.',
    '...#.##..##..',
    '...#.#....#..',
    '.............',
    '.............',
    '.............',
  ],
  eagle: [
    '......#......',
    '.....###.....',
    '.....#.#.....',
    '#....###....#',
    '##..#####..##',
    '###########.#',
    '.###########.',
    '..#########..',
    '....#####....',
    '....##.##....',
    '...##...##...',
    '.............',
    '.............',
  ],
  tower: [
    '..#.#.#.#.#..',
    '..#########..',
    '...#######...',
    '...##.#.##...',
    '...#######...',
    '...###.###...',
    '...#######...',
    '...##...##...',
    '...##...##...',
    '..#########..',
    '.###########.',
    '.............',
    '.............',
  ],
  crown: [
    '.............',
    '.#....#....#.',
    '.##..###..##.',
    '.###.###.###.',
    '.###########.',
    '.###########.',
    '.##+##+##+##.',
    '.###########.',
    '.###########.',
    '.............',
    '.............',
    '.............',
    '.............',
  ],
  rose: [
    '.............',
    '....##.##....',
    '...#######...',
    '..###+#+###..',
    '..##+###+##..',
    '..###+#+###..',
    '...#######...',
    '....##.##....',
    '......#......',
    '....#.#.#....',
    '.....###.....',
    '......#......',
    '.............',
  ],
};

export function drawCrest(crest: CrestId, team: KingdomColor, scale = 1): PixelCanvas {
  const W = 20;
  const H = 24;
  const pc = new PixelCanvas(W, H);
  // heater shield
  for (let y = 1; y < H - 1; y++) {
    let hw = 8.5;
    if (y > 12) hw = 8.5 * Math.sqrt(Math.max(0, 1 - ((y - 12) / 11) ** 2));
    for (let x = Math.floor(10 - hw); x < Math.ceil(10 + hw); x++) {
      const l = x < 10 ? 0.12 : -0.12;
      pc.px(x, y, shade(team.main, l - (y / H) * 0.15));
    }
  }
  // charge in gold/white
  const ch = CHARGES[crest];
  const gold = RAMP.goldm[4];
  const goldS = RAMP.goldm[2];
  for (let y = 0; y < 13; y++)
    for (let x = 0; x < 13; x++) {
      const c = ch[y][x];
      if (c === '#') pc.px(x + 3, y + 4, gold);
      else if (c === '+') pc.px(x + 3, y + 4, goldS);
    }
  // rim
  pc.outline(OUTLINE, 0.9);
  // top highlight
  pc.hline(3, 16, 1, shade(team.light, 0.2));
  if (scale === 1) return pc;
  const out = new PixelCanvas(W * scale, H * scale);
  for (let y = 0; y < H * scale; y++) for (let x = 0; x < W * scale; x++) out.data[y * out.w + x] = pc.data[Math.floor(y / scale) * W + Math.floor(x / scale)];
  return out;
}

export function crestUrl(crest: CrestId, team: KingdomColor): string {
  return drawCrest(crest, team).flush().toDataURL();
}

/** 9-slice wooden frame with brass corners (border-image source, slice 6) */
export function frameUrl(kind: 'wood' | 'parch' | 'dark' | 'button' | 'buttonDown' | 'gold' = 'wood'): string {
  const S = 18;
  const pc = new PixelCanvas(S, S);
  const W = RAMP.wood;
  const fill = kind === 'parch' ? '#d9c9a3' : kind === 'dark' ? '#241a22' : kind === 'gold' ? '#3a2a1c' : kind === 'button' ? '#5a3c26' : kind === 'buttonDown' ? '#43291a' : '#2e2228';
  pc.rect(0, 0, S, S, fill);
  // outer dark line, wood band, inner bevel
  const band = kind === 'gold' ? RAMP.goldm : W;
  for (let i = 0; i < S; i++) {
    for (let t = 0; t < 4; t++) {
      const c = t === 0 ? OUTLINE : t === 1 ? band[kind === 'buttonDown' ? 2 : 4] : t === 2 ? band[3] : band[1];
      pc.px(i, t, c);
      pc.px(t, i, c);
      pc.px(i, S - 1 - t, t === 1 ? band[2] : c);
      pc.px(S - 1 - t, i, t === 1 ? band[2] : c);
    }
  }
  // corners: brass rivets
  const G = RAMP.goldm;
  for (const [x, y] of [[1, 1], [S - 3, 1], [1, S - 3], [S - 3, S - 3]]) {
    pc.rect(x, y, 2, 2, G[3]);
    pc.px(x, y, G[4]);
  }
  if (kind === 'parch') {
    for (let y = 4; y < S - 4; y++) for (let x = 4; x < S - 4; x++) if (((x * 7 + y * 13) % 11) === 0) pc.px(x, y, '#cdbb93');
  }
  return pc.flush().toDataURL();
}
