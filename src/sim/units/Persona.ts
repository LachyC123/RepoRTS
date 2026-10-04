import type { Era } from '../../data/era';
import type { Random } from '../../core/Random';

/**
 * Every soldier is somebody: a name, a rank earned by surviving and fighting, and one trait that
 * colours how they behave when nobody is giving orders (or when everything goes wrong).
 */
export type Trait = 'brave' | 'coward' | 'hothead' | 'joker' | 'lazy' | 'loyal' | 'wanderer' | 'trigger' | 'lucky' | 'steady';

export type PersonaState = 'normal' | 'berserk' | 'tired' | 'nap' | 'wander' | 'rescue' | 'brawl' | 'party' | 'drunk' | 'camp';

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
  /** how they feel about other soldiers (id -> -100..100) */
  bonds: Record<number, number>;
  /** close friends (ids) and the one person they cannot stand */
  friends: number[];
  rival: number;
  /** the enemy who killed a friend, and whose friend it was */
  nemesis: number;
  nemesisFor: string;
  /** 0..100: marching and fighting tire, rest restores */
  fatigue: number;
  /** a few things that happened to them, for the soldier panel */
  memories: string[];
  /** where they are from and what they did before the war */
  home: string;
  job: string;
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
    bonds: {},
    friends: [],
    rival: 0,
    nemesis: 0,
    nemesisFor: '',
    fatigue: 0,
    memories: [],
    home: rng.pick(HOMES[era]),
    job: rng.pick(JOBS[era]),
  };
}

const HOMES: Record<Era, string[]> = {
  medieval: ['a pig farm near Oakhaven', 'the docks at Saltmere', 'a mill on the Brightwater', 'a hut in the Ashwood', 'the market at Crown Hill', 'a goat farm', 'nowhere in particular', 'a monastery (they left)', 'the far side of the hills', 'a very small village'],
  modern: ['a farm outside Oakhaven', 'a flat above a chip shop', 'the suburbs', 'a fishing town', 'the capital (they never shut up about it)', 'a caravan', 'a dairy farm', 'a tower block', 'a mountain village', 'a town with one traffic light'],
};
const JOBS: Record<Era, string[]> = {
  medieval: ['a turnip farmer', 'a baker', 'a cobbler', 'a juggler', 'a goose-herd', 'a failed bard', 'a blacksmith’s apprentice', 'a monk (briefly)', 'a rat-catcher', 'a fisherman', 'a thatcher', 'a pickpocket (reformed)'],
  modern: ['a postman', 'a barista', 'a plumber', 'an accountant', 'a PE teacher', 'a lorry driver', 'a dental hygienist', 'a wedding DJ', 'a librarian', 'an influencer (11 followers)', 'a bin man', 'a stand-up comic (bad)'],
};

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
  | 'incoming'
  | 'friend'
  | 'grief'
  | 'revenge'
  | 'avenged'
  | 'rivalry'
  | 'brawl'
  | 'cheerfight'
  | 'makeup'
  | 'party'
  | 'drunk'
  | 'story'
  | 'tired'
  | 'hungry'
  | 'mascot'
  | 'salute'
  | 'weather'
  | 'goose'
  | 'river'
  | 'lost';

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
    friend: ['You’re alright, {buddy}.', 'Stick with me, {buddy}.', '{buddy}! Saved you a turnip.', 'Me and {buddy} against the world.'],
    grief: ['Not {buddy}... not like this.', '{buddy}! NO!', 'Who’s going to snore next to me now, {buddy}?', 'I’ll tell your mum, {buddy}.'],
    revenge: ['That’s for {buddy}!', 'THIS ONE’S FOR {buddy}!', 'You killed {buddy}. Now it’s your turn.', 'Remember {buddy}?!'],
    avenged: ['Rest easy, {buddy}. Got him.', 'It’s done, {buddy}.', 'Avenged. Doesn’t feel better.'],
    rivalry: ['Oh great. {buddy} again.', 'Keep your elbows to yourself, {buddy}.', 'Nobody asked you, {buddy}.', '{buddy} snores like a bear.'],
    brawl: ['Say that again!', 'Your mum’s a catapult!', 'Put ’em up!', 'You started it!', 'Not the nose!'],
    cheerfight: ['Fight! Fight! Fight!', 'Two coppers on the big one!', 'Ooh, right in the helmet!', 'Someone get the sergeant!'],
    makeup: ['...Want a drink?', 'Fine. You’re alright.', 'Friends?', 'Good punch, actually.'],
    party: ['WE DID IT!', 'Drinks on the king!', 'Huzzah! Huzzah!', 'Who brought the mead?'],
    drunk: ['Hic!', 'I love you guys.', 'Who moved the castle?', 'I can see three of you.', 'I’m fine. FINE.', 'Is the ground supposed to wobble?'],
    story: ['...and then the goat exploded.', 'My uncle fought a bear once. Lost.', 'Back home I was {job}.', 'I miss {home}.', 'Did I tell you about the cheese?', 'When this is over I’m opening a tavern.'],
    tired: ['My feet...', 'Can we stop? Just for a bit?', 'I’m too old for this.', 'How far IS it?'],
    hungry: ['Turnips again?', 'I could eat a horse. Sorry, horse.', 'When did we last eat?', 'My belly’s louder than the drums.'],
    mascot: ['Who’s a good boy?!', 'Look! A dog! Can we keep him?', 'He’s one of us now.'],
    salute: ['Sir!', 'Your Grace!', 'Look sharp, it’s the boss!'],
    weather: ['Rain. Lovely.', 'My boots are full of pond.', 'Who ordered this weather?'],
    goose: ['THE GOOSE!', 'It’s got Wat! RUN!', 'Nobody look it in the eye!', 'Honk... honk...'],
    river: ['I’m all wet!', 'Who put a river there?!', 'Fish! In my armour!'],
    lost: ['I think we’re lost.', 'This tree looks familiar.', 'Left at the big rock. Or was it right?'],
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
    friend: ['You’re alright, {buddy}.', 'Got your back, {buddy}.', '{buddy}! Saved you a ration bar.', 'Me and {buddy}. Best fireteam.'],
    grief: ['Not {buddy}... not like this.', '{buddy}! NO!', 'Who’s going to steal my socks now, {buddy}?', 'I’ll tell your mum, {buddy}.'],
    revenge: ['That’s for {buddy}!', 'THIS ONE’S FOR {buddy}!', 'You got {buddy}. Your turn.', 'Remember {buddy}?!'],
    avenged: ['Rest easy, {buddy}. Got him.', 'It’s done, {buddy}.', 'Avenged. Doesn’t feel better.'],
    rivalry: ['Oh great. {buddy} again.', 'Stop humming, {buddy}.', 'Nobody asked you, {buddy}.', '{buddy} chews like a cow.'],
    brawl: ['Say that again!', 'Your mum’s a tank!', 'Put ’em up!', 'You started it!', 'Not the face!'],
    cheerfight: ['Fight! Fight! Fight!', 'Fiver on the short one!', 'Ooh, right in the helmet!', 'Someone get the sarge!'],
    makeup: ['...Want a beer?', 'Fine. You’re alright.', 'Friends?', 'Good punch, actually.'],
    party: ['WE DID IT!', 'Drinks are on the general!', 'Woooo!', 'Put some music on!'],
    drunk: ['Hic!', 'I love you guys.', 'Who moved the base?', 'I can see three of you.', 'I’m fine. FINE.', 'Is the ground supposed to wobble?'],
    story: ['...and then the goat exploded.', 'My uncle drove a tank once. Into a lake.', 'Back home I was {job}.', 'I miss {home}.', 'Did I tell you about the cheese?', 'When this is over I’m opening a bar.'],
    tired: ['My feet...', 'Five minutes. Please.', 'I’m too old for this.', 'How far IS it?'],
    hungry: ['Not the beans again.', 'I could eat a whole jeep.', 'When did we last eat?', 'My stomach’s louder than the artillery.'],
    mascot: ['Who’s a good boy?!', 'Look! A dog! Can we keep him?', 'He’s one of us now.'],
    salute: ['Sir!', 'General on deck!', 'Look busy, it’s the boss!'],
    weather: ['Rain. Lovely.', 'My boots are full of pond.', 'Who ordered this weather?'],
    goose: ['THE GOOSE!', 'It’s got Mike! RUN!', 'Nobody look it in the eye!', 'Honk... honk...'],
    river: ['I’m all wet!', 'Who put a river there?!', 'My radio! My RADIO!'],
    lost: ['I think we’re lost.', 'The map is upside down. Again.', 'GPS says we’re in the sea.'],
  },
};

export function line(rng: Random, era: Era, kind: LineKind, vars: { name?: string; buddy?: string; home?: string; job?: string } = {}) {
  const l = rng.pick(LINES[era][kind]);
  return l
    .replace('{name}', vars.name ?? 'mate')
    .replace('{buddy}', vars.buddy ?? 'the lads')
    .replace('{home}', vars.home ?? 'home')
    .replace('{job}', vars.job ?? 'somebody');
}
