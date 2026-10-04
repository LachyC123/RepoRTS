import type { Era } from '../../data/era';
import type { Random } from '../../core/Random';

/**
 * Every soldier is somebody: a name, a rank earned by surviving and fighting, and one trait that
 * colours how they behave when nobody is giving orders (or when everything goes wrong).
 */
export type Trait = 'brave' | 'coward' | 'hothead' | 'joker' | 'lazy' | 'loyal' | 'wanderer' | 'trigger' | 'lucky' | 'steady';

export type PersonaState = 'normal' | 'berserk' | 'tired' | 'nap' | 'wander' | 'rescue';

export interface Persona {
  first: string;
  last: string;
  /** vehicles get a crew nickname instead of a rank */
  nick?: string;
  trait: Trait;
  rank: number;
  kills: number;
  state: PersonaState;
  stateT: number;
  /** seconds idle and safe (drives naps, wandering, chatter) */
  idleT: number;
  /** cooldown before this soldier speaks again */
  sayT: number;
  /** cooldown before the next quirk can trigger */
  quirkT: number;
  luckUsed: boolean;
  rescueTarget: number;
  rescues: number;
  wounds: number;
  /** times this soldier has broken and run */
  routs: number;
}

export const TRAITS: Record<Trait, { label: string; desc: string; weight: number }> = {
  brave: { label: 'Brave', desc: 'Rarely breaks. Steadies the soldiers around them.', weight: 1 },
  coward: { label: 'Nervous', desc: 'Panics under fire and may run for it.', weight: 1 },
  hothead: { label: 'Hothead', desc: 'Might charge in alone, screaming.', weight: 1 },
  joker: { label: 'Joker', desc: 'Cracks jokes. Lifts the mood of the squad.', weight: 1 },
  lazy: { label: 'Lazy', desc: 'Naps when nothing is happening.', weight: 0.8 },
  loyal: { label: 'Loyal', desc: 'Runs into fire to drag wounded friends out.', weight: 1 },
  wanderer: { label: 'Curious', desc: 'Wanders off to look at flowers, ducks and clouds.', weight: 0.8 },
  trigger: { label: 'Trigger-happy', desc: 'Shoots at bushes. And shadows.', weight: 0.7 },
  lucky: { label: 'Lucky', desc: 'Shrugs off one hit that should have killed them.', weight: 0.7 },
  steady: { label: 'Steady', desc: 'Calm, reliable, unremarkable. Exactly what you want.', weight: 1.2 },
};

const NAMES: Record<Era, { first: string[]; last: string[]; nick: string[] }> = {
  medieval: {
    first: ['Wat', 'Hob', 'Edda', 'Marta', 'Godwin', 'Agnes', 'Piers', 'Ysolde', 'Ralf', 'Odo', 'Gisela', 'Hugh', 'Maud', 'Tybalt', 'Elric', 'Bertram', 'Joan', 'Alys', 'Cuthbert', 'Wynn', 'Osric', 'Bea', 'Jory', 'Sibyl', 'Tam', 'Hilda', 'Ned', 'Rowan', 'Esme', 'Bran'],
    last: ['Cooper', 'Thatcher', 'Fletcher', 'Mudd', 'Brewer', 'Ashdown', 'Crowe', 'Tanner', 'Wickham', 'Pike', 'Holt', 'Marsh', 'Kettle', 'Dunn', 'Shepherd', 'Barley', 'Oakes', 'Fenn', 'Gale', 'Cobb', 'Redd', 'Waller', 'Mossop', 'Hogg', 'Turnip'],
    nick: ['Old Grey', 'Thunderhoof', 'Biscuit', 'Lady Mud', 'Ironside', 'Clover'],
  },
  modern: {
    first: ['Mike', 'Sam', 'Jenny', 'Rosa', 'Dmitri', 'Kofi', 'Lena', 'Raj', 'Tommy', 'Ana', 'Yuki', 'Priya', 'Ben', 'Chloe', 'Marco', 'Ivan', 'Zoe', 'Omar', 'Kate', 'Leo', 'Nadia', 'Gus', 'Ines', 'Theo', 'Mia', 'Abdul', 'Hank', 'Sofia', 'Jun', 'Dot'],
    last: ['Hale', 'Brooks', 'Novak', 'Kowalski', 'Okafor', 'Silva', 'Tanaka', 'Reyes', 'Murphy', 'Schultz', 'Haddad', 'Lindqvist', 'Petrov', 'Mendez', "O'Neil", 'Park', 'Dubois', 'Nkemelu', 'Fischer', 'Moreau', 'Kaur', 'Baker', 'Volkov', 'Lopez', 'Spud'],
    nick: ['Big Bertha', 'Rosie', 'Iron Duke', 'Muddy Mabel', 'Lucky Seven', 'The Kettle', 'Grandma', 'Old Faithful', 'Rust Bucket', 'Thumper'],
  },
};

const RANKS: Record<Era, string[]> = {
  medieval: ['Recruit', 'Soldier', 'Veteran', 'Captain'],
  modern: ['Pvt.', 'Cpl.', 'Sgt.', 'Lt.'],
};
export const RANK_KILLS = [0, 3, 7, 14];

export function newPersona(rng: Random, era: Era, vehicle: boolean): Persona {
  const pool = NAMES[era];
  let total = 0;
  for (const t of Object.values(TRAITS)) total += t.weight;
  let r = rng.next() * total;
  let trait: Trait = 'steady';
  for (const [k, t] of Object.entries(TRAITS) as [Trait, (typeof TRAITS)[Trait]][]) {
    r -= t.weight;
    if (r <= 0) {
      trait = k;
      break;
    }
  }
  return {
    first: rng.pick(pool.first),
    last: rng.pick(pool.last),
    nick: vehicle ? rng.pick(pool.nick) : undefined,
    trait,
    rank: 0,
    kills: 0,
    state: 'normal',
    stateT: 0,
    idleT: 0,
    sayT: 2 + rng.next() * 6,
    quirkT: 10 + rng.next() * 20,
    luckUsed: false,
    rescueTarget: 0,
    rescues: 0,
    wounds: 0,
    routs: 0,
  };
}

export function rankTitle(p: Persona, era: Era) {
  return RANKS[era][Math.min(p.rank, RANKS[era].length - 1)];
}

/** "Sgt. Hale" (short) or "Sgt. Mike Hale" (full); vehicles go by their nickname */
export function personaName(p: Persona, era: Era, full = false) {
  if (p.nick) return `"${p.nick}"`;
  return `${rankTitle(p, era)} ${full ? p.first + ' ' : ''}${p.last}`;
}

export type LineKind =
  | 'panic'
  | 'berserk'
  | 'snap'
  | 'joke'
  | 'nap'
  | 'wake'
  | 'wander'
  | 'potshot'
  | 'chatter'
  | 'kill'
  | 'promote'
  | 'down'
  | 'medic'
  | 'rescue'
  | 'saved'
  | 'lucky'
  | 'rally'
  | 'order'
  | 'cheer'
  | 'brave'
  | 'desert'
  | 'burn'
  | 'song'
  | 'awful'
  | 'incoming';

const LINES: Record<Era, Record<LineKind, string[]>> = {
  medieval: {
    panic: ['Run awaaay!', "I'm needed at the farm!", 'My mother warned me!', 'Sod this!', 'Fetch the priest!', 'Tactical retreat!', 'Not the face!'],
    berserk: ['FOR THE CROWN!', 'BLOOD AND GLORY!', 'COME HERE, YOU!', "I'LL BITE YOUR KNEES OFF!", 'AAAAARGH!', 'WHO WANTS SOME?!'],
    snap: ["I can't take it any more!", 'WHY IS EVERYONE STABBING?', "That's it, I've had it!"],
    joke: ['Why did the knight cross the moat? He didn’t.', 'This armour chafes.', 'Is it supper yet?', 'My horse is smarter than the sergeant.', 'I joined for the free hat.', 'I sharpened my sword. Now it’s a dagger.'],
    nap: ['Zzz...', 'Five more minutes...', 'Zzz... cheese...'],
    wake: ["Huh? I'm up! I'm up!", "Wasn't sleeping!", 'Who goes there?!'],
    wander: ['Ooh, a butterfly!', 'Back in a tick.', 'Just stretching my legs.', 'Is that a duck?', 'Pretty flowers...'],
    potshot: ['Thought I saw a wolf.', '...it was a bush.', 'Oops.'],
    chatter: ['Nice weather for a war.', 'My feet hurt.', 'I miss my dog.', 'When do we get paid?', 'Quiet. Too quiet.', 'Smells like rain.'],
    kill: ['Got one!', 'Down you go!', 'Ha!', 'Next!', 'That one’s for {buddy}!'],
    promote: ['Promoted? Me?!', "I'm somebody now.", 'Mum would be proud.'],
    down: ['MEDIC!', "I'm hit!", 'Ow ow ow!', 'Just a flesh wound!', 'Tell my goat I love her!'],
    medic: ['Man down!', '{name} is hit!', 'Help {name}!'],
    rescue: ['Hang on, {name}!', "I've got you!", 'Not today, {name}!'],
    saved: ['Thanks, {buddy}!', 'I owe you an ale.', 'Am I dead? No? Grand.'],
    lucky: ['Missed me!', 'That was close!', 'Not a scratch!'],
    rally: ['Right... right. I’m back.', 'Where were we?', 'I was scouting. Behind us.'],
    order: ['Aye!', 'At once!', 'As you command.', 'Marching!', 'On it!'],
    cheer: ['Ours now!', 'Raise the banner!', 'Huzzah!'],
    brave: ['Hold the line!', 'Stand fast!', 'With me!'],
    desert: ['I quit!', "I'm off to be a goatherd.", 'Find another fool!', 'Banditry pays better!'],
    burn: ['HOT HOT HOT!', 'I’M ON FIRE!', 'Water! WATER!', 'Stop, drop and— AAAH!'],
    song: ['♪ Hey nonny nonny! ♪', '♪ Our king has a very big crown ♪', '♪ Fa la la, stab stab stab ♪', '♪ Oh the turnips of home ♪'],
    awful: ['♪ ...wait, how does it go? ♪', '♪ *horrible screech* ♪', 'Sorry. Wrong song.', '♪ La la la LAAAA— ♪'],
    incoming: ['INCOMING!', 'What’s that in the sky?!', 'RUN!', 'Is that... a burning rock?!'],
  },
  modern: {
    panic: ['Nope. Nope. NOPE.', 'I left the oven on!', "This wasn't in the brochure!", 'Tell my mum I was brave!', 'Tactical retreat!!', "I'm too young for this!", 'NOT TODAY!'],
    berserk: ['COME AT ME!', 'LEEEROY—', 'FOR AUNT MARGE!', "I'M INVINCIBLE!", 'WHO WANTS SOME?!', 'YEEHAW!'],
    snap: ["I can't take it any more!", 'WHY IS EVERYONE SHOOTING?', "That's it, I've had it!"],
    joke: ['Why did the tank cross the road? Orders.', 'Who packed these rations? A war criminal.', "My helmet's on backwards, isn't it?", 'I joined for the free hat.', 'Knock knock. — Not now.', 'Is it lunch yet?'],
    nap: ['Zzz...', 'Five more minutes...', 'Zzz... pizza...'],
    wake: ["Huh? I'm up! I'm up!", "Wasn't sleeping!", 'Contact?! Oh. No.'],
    wander: ['Ooh, a butterfly!', 'Back in a sec.', 'Just stretching my legs.', 'Is that a duck?', 'Nice flowers.'],
    potshot: ['Thought I saw something.', '...it was a bush.', 'Oops.', 'Testing! Testing!'],
    chatter: ['Nice weather for a war.', 'My feet hurt.', 'Anyone got a light?', 'I miss my dog.', 'When do we get paid?', 'Quiet. Too quiet.'],
    kill: ['Got one!', 'Scratch one!', 'Target down.', 'Ha!', "That's for {buddy}!"],
    promote: ['Promoted? Me?!', "I'm somebody now.", 'Do I get a bigger hat?'],
    down: ['MEDIC!', "I'm hit!", 'Ow ow ow!', 'Just a flesh wound!', 'Tell my dog I love him!'],
    medic: ['Man down!', "{name}'s hit!", 'MEDIC! {name} is down!'],
    rescue: ['Hang on, {name}!', "I've got you!", 'Not today, {name}!'],
    saved: ['Thanks, {buddy}!', 'I owe you a beer.', 'Am I dead? No? Great.'],
    lucky: ['Missed me!', 'That was close!', 'Not a scratch!'],
    rally: ['Okay... okay. I’m back.', 'Right. Where were we?', 'I was flanking. Backwards.'],
    order: ['Roger!', 'On it!', 'Moving out!', 'Copy that.', 'Oscar Mike!'],
    cheer: ['Ours now!', 'Raise the flag!', 'Woo!'],
    brave: ['Hold the line!', 'Stay on me!', 'Keep firing!'],
    desert: ['I quit!', "I'm going home!", 'Not my war!', "Tell the sarge I'm sick."],
    burn: ['HOT HOT HOT!', 'I’M ON FIRE!', 'Medic! A wet one!', 'Stop, drop and— AAAH!'],
    song: ['♪ *heroic droning* ♪', '♪ Scotland the Brave! ♪', '♪ *bagpipe noises* ♪', '♪ Amazing Grace, more or less ♪'],
    awful: ['♪ *dying goose noise* ♪', '♪ ...wait, how does it go? ♪', 'Sorry. Bag’s got a hole.', '♪ *horrible screech* ♪'],
    incoming: ['INCOMING!', 'MISSILE!', 'RUN!', 'Is that... for us?!'],
  },
};

export function line(rng: Random, era: Era, kind: LineKind, vars: { name?: string; buddy?: string } = {}) {
  const l = rng.pick(LINES[era][kind]);
  return l.replace('{name}', vars.name ?? 'mate').replace('{buddy}', vars.buddy ?? 'the lads');
}
