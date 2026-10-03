/** World tile size in world pixels. All sprites are authored against this scale. */
export const TILE = 16;
/** Simulation fixed timestep (seconds). */
export const SIM_DT = 1 / 30;

export const NEUTRAL = 4 as const;
export type KingdomId = 0 | 1 | 2 | 3;
export type FactionId = KingdomId | typeof NEUTRAL;
export const KINGDOMS: readonly KingdomId[] = [0, 1, 2, 3];

export type ResKey = 'gold' | 'wood' | 'food' | 'stone';
export const RES_KEYS: readonly ResKey[] = ['gold', 'wood', 'food', 'stone'];
export type Resources = Record<ResKey, number>;
export type Cost = Partial<Resources>;

export const emptyRes = (): Resources => ({ gold: 0, wood: 0, food: 0, stone: 0 });

/** Domination victory */
export const DOMINATION_SHARE = 0.7;
export const DOMINATION_HOLD = 90;
/** Capital loss recovery */
export const CAPITAL_RECOVERY_TIME = 60;
export const COMMANDER_RESPAWN = 60;
