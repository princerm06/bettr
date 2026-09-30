/** Representation probes. Audit-only. Never used as training labels. */

export type StateKey =
  | 'completed'
  | 'negated'
  | 'future'
  | 'almost'
  | 'plan'
  | 'desire'
  | 'passive'
  | 'purchase'
  | 'shortCompleted';

export type GeometryFamily = {
  id: string;
  domain: string;
  unseenNote: string;
  states: Record<StateKey, string>;
};

export const GEOMETRY_FAMILIES: GeometryFamily[] = [
  {
    id: 'geo.lap_swim',
    domain: 'Physical Prowess',
    unseenNote: 'not gym/bouldering training families',
    states: {
      completed: 'Swam twenty laps this morning and timed the last one',
      negated: "I didn't swim at all today",
      future: "I'll swim twenty laps tomorrow",
      almost: 'I almost made it to the pool and turned around',
      plan: 'Planning a swim block after midterms',
      desire: 'I want to become a real swimmer',
      passive: 'Watched Olympic swimming highlights in bed',
      purchase: 'Bought new goggles and left them in the bag',
      shortCompleted: 'swam laps',
    },
  },
  {
    id: 'geo.orgo_mechanism',
    domain: 'Academics',
    unseenNote: 'not biochem-cards / not ochem-video exam text',
    states: {
      completed: 'Redrew three SN2 mechanisms from memory',
      negated: "I didn't open the mechanism packet",
      future: "I'll redraw the mechanisms tonight",
      almost: 'I almost started the mechanism sheet',
      plan: 'Planning an orgo catch-up weekend',
      desire: 'I wish I understood mechanisms',
      passive: 'Left an orgo lecture on in the background',
      purchase: 'Ordered a molecular model kit and never opened it',
      shortCompleted: 'redrew mechanisms',
    },
  },
  {
    id: 'geo.cold_email',
    domain: 'Career',
    unseenNote: 'not cover-letter Stage 3 family',
    states: {
      completed: 'Sent two informational-interview emails after editing them',
      negated: "I didn't send any outreach",
      future: "I'll send the outreach emails tomorrow",
      almost: 'I almost hit send on the outreach draft',
      plan: 'Planning a networking sprint next month',
      desire: 'I want to be better at reaching out',
      passive: 'Watched a video about cold emailing',
      purchase: 'Bought a domain for a portfolio I have not built',
      shortCompleted: 'sent two outreach emails',
    },
  },
  {
    id: 'geo.spice_blend',
    domain: 'Nutrition & Cooking',
    unseenNote: 'not stir-fry Stage 3 family',
    states: {
      completed: 'Toasted cumin and blended a spice mix for the week',
      negated: "I didn't cook or prep anything",
      future: "I'll toast spices tomorrow",
      almost: 'I almost started the spice mix',
      plan: 'Planning to meal prep when I have energy',
      desire: 'I want to cook from scratch more',
      passive: 'Watched a cooking competition while ordering takeout',
      purchase: 'Bought a spice rack and left it boxed',
      shortCompleted: 'toasted cumin',
    },
  },
  {
    id: 'geo.floss_bridge',
    domain: 'Appearance & Self-Care',
    unseenNote: 'not night-wash Stage 3 family',
    states: {
      completed: 'Flossed around the bridge and used the prescribed rinse',
      negated: "I didn't floss tonight",
      future: "I'll floss tomorrow for sure",
      almost: 'I almost flossed and then went to sleep',
      plan: 'Planning a better dental routine',
      desire: 'I should take dental stuff seriously',
      passive: 'Watched a dentist TikTok',
      purchase: 'Bought a water flosser still in the box',
      shortCompleted: 'flossed around the bridge',
    },
  },
  {
    id: 'geo.psalm_copy',
    domain: 'Spirituality',
    unseenNote: 'not friday salah / evening liturgy holdouts',
    states: {
      completed: 'Copied a psalm by hand and sat with the last line',
      negated: "I didn't pray or read anything",
      future: "I'll copy a psalm tomorrow",
      almost: 'I almost opened the psalter',
      plan: 'Planning a more consistent prayer life',
      desire: 'I want to be more spiritually grounded',
      passive: 'Scrolled sermons in bed',
      purchase: 'Bought a leather journal for verses and never wrote',
      shortCompleted: 'copied a psalm',
    },
  },
];

export const STATE_KEYS: StateKey[] = [
  'completed',
  'negated',
  'future',
  'almost',
  'plan',
  'desire',
  'passive',
  'purchase',
  'shortCompleted',
];
