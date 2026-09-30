/**
 * Stage 5 action-state arena. Isolated from production scoring.
 *
 * Each row is a premise (the log) plus one completion criterion.
 * Gold is the MNLI relationship to that criterion, not an XP decision.
 */
import { FALSE_CREDIT_SAFETY, NEGATION_PROBE, SHORT_VALID } from '../stage2/fixtures';
import { STAGE3_NEW } from '../stage3/newExamples';
import { GEOMETRY_FAMILIES, type StateKey } from '../stage4/geometryProbes';

export type NliGold = 'entails' | 'neutral' | 'contradicts';

export type ProductCaution = 'underspecified' | 'implausible' | 'implausible_volume';

export type Stage5Example = {
  id: string;
  text: string;
  target: string;
  hypothesis: string;
  gold: NliGold;
  slice: string;
  source: string;
  group: string;
  domain?: string;
  /** True when SUPPORTS would award an action Bettr should not treat as supported. */
  unsafeIfSupports: boolean;
  productCaution?: ProductCaution;
  note?: string;
};

const STATE56 = new Set<StateKey>(['completed', 'negated', 'future', 'almost']);

const GOLD_BY_STATE: Record<StateKey, NliGold> = {
  completed: 'entails',
  shortCompleted: 'entails',
  negated: 'contradicts',
  future: 'neutral',
  almost: 'neutral',
  plan: 'neutral',
  desire: 'neutral',
  passive: 'neutral',
  purchase: 'neutral',
};

export function hypothesisFor(target: string): string {
  return `The person already ${target}.`;
}

function row(partial: Omit<Stage5Example, 'hypothesis' | 'unsafeIfSupports'> & {
  unsafeIfSupports?: boolean;
}): Stage5Example {
  const unsafe =
    partial.unsafeIfSupports !== undefined ? partial.unsafeIfSupports : partial.gold !== 'entails';
  return {
    ...partial,
    hypothesis: hypothesisFor(partial.target),
    unsafeIfSupports: unsafe,
  };
}

function targetFromFirstPerson(done: string): string {
  return done.replace(/^I /, '').replace(/\.$/, '');
}

const FALSE_CREDIT_TARGETS: Record<string, { target: string; gold: NliGold; slice: string; productCaution?: ProductCaution; note?: string }> = {
  'FC-01': { target: 'worked out', gold: 'neutral', slice: 'future' },
  'FC-02': { target: 'studied', gold: 'neutral', slice: 'intention' },
  'FC-03': { target: 'updated their resume', gold: 'neutral', slice: 'intention' },
  'FC-04': { target: 'went to the gym', gold: 'contradicts', slice: 'negation' },
  'FC-05': { target: 'finished the problem set', gold: 'contradicts', slice: 'attempted' },
  'FC-06': { target: 'submitted an application', gold: 'contradicts', slice: 'negation' },
  'FC-07': { target: 'studied', gold: 'neutral', slice: 'passive' },
  'FC-08': { target: 'practiced a skill', gold: 'neutral', slice: 'passive' },
  'FC-09': { target: 'studied for class', gold: 'neutral', slice: 'purchase' },
  'FC-10': { target: 'worked out', gold: 'neutral', slice: 'purchase' },
  'FC-11': { target: 'completed a workout', gold: 'neutral', slice: 'vague' },
  'FC-12': { target: 'cleaned the room', gold: 'neutral', slice: 'observation' },
  'FC-13': { target: 'trained', gold: 'neutral', slice: 'category_adjacent' },
  'FC-14': { target: 'reviewed their budget', gold: 'neutral', slice: 'insufficient' },
  'FC-15': { target: 'studied', gold: 'neutral', slice: 'gaming' },
  'FC-16': { target: 'studied', gold: 'neutral', slice: 'gaming' },
  'FC-17': { target: 'lifted weights', gold: 'neutral', slice: 'implausible', productCaution: 'implausible' },
  'FC-18': {
    target: 'read books',
    gold: 'entails',
    slice: 'implausible_volume',
    productCaution: 'implausible_volume',
    note: 'Linguistic entailment of reading can hold while the volume is not creditworthy.',
  },
  'FC-19': { target: 'advanced their career', gold: 'neutral', slice: 'junk' },
  'FC-20': { target: 'prayed', gold: 'neutral', slice: 'desire' },
  'FC-21': { target: 'cooked a healthy meal', gold: 'neutral', slice: 'future' },
  'FC-22': { target: 'practiced', gold: 'neutral', slice: 'attendance' },
  'FC-23': { target: 'reviewed their finances', gold: 'neutral', slice: 'insufficient' },
  'FC-24': { target: 'contacted a recruiter', gold: 'neutral', slice: 'passive' },
};

const SHORT_VALID_TARGETS: Record<string, { target: string; slice: string }> = {
  'SV-APP-1': { target: 'did their skincare routine', slice: 'paraphrase' },
  'SV-APP-2': { target: 'flossed and washed their face', slice: 'noisy' },
  'SV-FASH-1': { target: 'styled an outfit', slice: 'paraphrase' },
  'SV-FASH-2': { target: 'hemmed their pants', slice: 'paraphrase' },
  'SV-ACAD-1': { target: 'studied calculus', slice: 'paraphrase' },
  'SV-ACAD-2': { target: 'finished calculus homework', slice: 'noisy' },
  'SV-CAR-1': { target: 'submitted an internship application', slice: 'paraphrase' },
  'SV-CAR-2': { target: 'tailored their resume', slice: 'paraphrase' },
  'SV-FIN-1': { target: 'logged their spending', slice: 'paraphrase' },
  'SV-FIN-2': { target: 'made a grocery budget', slice: 'paraphrase' },
  'SV-NUT-1': { target: 'meal prepped', slice: 'paraphrase' },
  'SV-NUT-2': { target: 'cooked chicken and rice', slice: 'paraphrase' },
  'SV-SOC-1': { target: 'called a friend', slice: 'paraphrase' },
  'SV-SOC-2': { target: 'texted a classmate to study', slice: 'paraphrase' },
  'SV-PHY-1': { target: 'completed a workout', slice: 'paraphrase' },
  'SV-PHY-2': { target: 'trained chest and triceps', slice: 'noisy' },
  'SV-MIND-1': { target: 'practiced guitar', slice: 'paraphrase' },
  'SV-MIND-2': { target: 'practiced piano', slice: 'paraphrase' },
  'SV-INN-1': { target: 'meditated', slice: 'paraphrase' },
  'SV-INN-2': { target: 'journaled', slice: 'paraphrase' },
  'SV-SPI-1': { target: 'prayed', slice: 'paraphrase' },
  'SV-SPI-2': { target: 'read a scripture passage', slice: 'paraphrase' },
};

const STAGE3_TARGETS: Record<string, { target: string; gold: NliGold; slice: string }> = {
  'S3-H01': { target: 'bouldered a problem', gold: 'entails', slice: 'paraphrase' },
  'S3-H02': { target: 'bouldered', gold: 'entails', slice: 'short' },
  'S3-H03': { target: 'bouldered', gold: 'contradicts', slice: 'negation' },
  'S3-H04': { target: 'started climbing', gold: 'neutral', slice: 'future' },
  'S3-H05': { target: 'climbed', gold: 'contradicts', slice: 'contradictory' },
  'S3-H06': { target: 'climbed', gold: 'neutral', slice: 'passive' },
  'S3-H07': { target: 'climbed', gold: 'neutral', slice: 'vague' },
  'S3-H08': { target: 'climbed the problem', gold: 'contradicts', slice: 'attempted' },
  'S3-H09': { target: 'built a wooden box lid', gold: 'entails', slice: 'paraphrase' },
  'S3-H10': { target: 'sanded', gold: 'entails', slice: 'short' },
  'S3-H11': { target: 'worked in the shop', gold: 'contradicts', slice: 'contradictory' },
  'S3-H12': { target: 'milled lumber', gold: 'neutral', slice: 'future' },
  'S3-H13': { target: 'milled lumber', gold: 'neutral', slice: 'purchase' },
  'S3-H14': { target: 'did woodworking', gold: 'neutral', slice: 'vague' },
  'S3-H15': { target: 'read the evening office', gold: 'entails', slice: 'paraphrase' },
  'S3-H16': { target: 'said evening prayers', gold: 'entails', slice: 'short' },
  'S3-H17': { target: 'prayed', gold: 'neutral', slice: 'desire' },
  'S3-H18': { target: 'prayed', gold: 'neutral', slice: 'passive' },
  'S3-H19': { target: 'did a spiritual practice', gold: 'neutral', slice: 'vague' },
  'S3-C01': { target: 'finished the problem set', gold: 'neutral', slice: 'future' },
  'S3-C02': { target: 'submitted an application', gold: 'contradicts', slice: 'contradictory' },
  'S3-C03': { target: 'worked out', gold: 'contradicts', slice: 'intention' },
  'S3-C04': { target: 'cooked with the groceries', gold: 'contradicts', slice: 'contradictory' },
  'S3-C05': { target: 'meditated', gold: 'contradicts', slice: 'attempted' },
  'S3-C06': { target: 'worked practice problems', gold: 'entails', slice: 'paraphrase' },
  'S3-C07': { target: 'talked with a classmate', gold: 'entails', slice: 'paraphrase' },
  'S3-C08': { target: 'cancelled subscriptions', gold: 'entails', slice: 'paraphrase' },
};

function newExamples(): Stage5Example[] {
  const specs: Array<Omit<Stage5Example, 'hypothesis' | 'unsafeIfSupports' | 'source' | 'group'> & {
    unsafeIfSupports?: boolean;
  }> = [
    { id: 'N-PAIR-OCHEM-YES', text: 'Watched 6 ochem videos', target: 'studied organic chemistry', gold: 'entails', slice: 'paraphrase', domain: 'Academics', note: 'Known Stage 1 false-negative topic. Criterion is the academic action.' },
    { id: 'N-PAIR-OCHEM-NO', text: 'Watched 6 ochem videos', target: 'practiced fashion', gold: 'neutral', slice: 'category_adjacent', domain: 'Fashion & Style', note: 'Same log, wrong criterion. Lexical overlap with watching is not fashion practice.' },
    { id: 'N-PAIR-MEM-NO', text: 'Bought a gym membership', target: 'worked out', gold: 'neutral', slice: 'purchase', domain: 'Physical Prowess' },
    { id: 'N-PAIR-MEM-YES', text: 'Bought a gym membership', target: 'bought a gym membership', gold: 'entails', slice: 'purchase_control', domain: 'Physical Prowess', note: 'Purchase entails the purchase criterion and not the practice criterion.' },
    { id: 'N-LEX-MENU', text: 'I studied the menu at dinner', target: 'studied for class', gold: 'neutral', slice: 'lexical_overlap', domain: 'Academics' },
    { id: 'N-LEX-DISH', text: 'I ran the dishwasher', target: 'went running', gold: 'neutral', slice: 'lexical_overlap', domain: 'Physical Prowess' },
    { id: 'N-LEX-MOOD', text: 'I lifted the mood in the group chat', target: 'lifted weights', gold: 'neutral', slice: 'lexical_overlap', domain: 'Physical Prowess' },
    { id: 'N-LEX-LOTION', text: 'I applied lotion', target: 'submitted a job application', gold: 'neutral', slice: 'lexical_overlap', domain: 'Career' },
    { id: 'N-NEG-SKIP', text: "I didn't skip the workout", target: 'worked out', gold: 'entails', slice: 'negation_scope', domain: 'Physical Prowess' },
    { id: 'N-NEG-DOUBLE', text: "It's not true that I didn't study", target: 'studied', gold: 'entails', slice: 'negation_scope', domain: 'Academics' },
    { id: 'N-NEG-NEVER', text: 'I never opened the textbook', target: 'studied from the textbook', gold: 'contradicts', slice: 'negation', domain: 'Academics' },
    { id: 'N-PART-QTY', text: 'I swam four laps and stopped', target: 'swam twenty laps', gold: 'neutral', slice: 'partial', domain: 'Physical Prowess' },
    { id: 'N-PART-DID', text: 'I swam four laps and stopped', target: 'swam laps', gold: 'entails', slice: 'partial', domain: 'Physical Prowess', note: 'Partial completion still entails the coarser action.' },
    { id: 'N-PART-QUIT', text: 'Did the first two problems and quit', target: 'finished the problem set', gold: 'contradicts', slice: 'partial', domain: 'Academics' },
    { id: 'N-PART-WORK', text: 'Did the first two problems and quit', target: 'worked on the problem set', gold: 'entails', slice: 'partial', domain: 'Academics' },
    { id: 'N-CONTRA', text: "I finished the set, but I didn't do a single problem", target: 'finished the problem set', gold: 'contradicts', slice: 'contradictory', domain: 'Academics' },
    { id: 'N-CONTRA-DRAFT', text: 'Sent the application, then realized it was still in drafts', target: 'submitted the application', gold: 'contradicts', slice: 'contradictory', domain: 'Career' },
    { id: 'N-PARA', text: 'knocked out my calc hw', target: 'finished calculus homework', gold: 'entails', slice: 'paraphrase', domain: 'Academics' },
    { id: 'N-PARA-VID', text: 'chem vids x6 and took notes', target: 'studied chemistry', gold: 'entails', slice: 'noisy', domain: 'Academics' },
    { id: 'N-ATT', text: 'Tried to meditate but quit after a minute of scrolling', target: 'meditated', gold: 'contradicts', slice: 'attempted', domain: 'Inner Wellbeing' },
    { id: 'N-ATT-BLANK', text: 'Started the cover letter and left it as a blank doc', target: 'wrote a cover letter', gold: 'contradicts', slice: 'attempted', domain: 'Career' },
    { id: 'N-VAGUE', text: 'studied', target: 'studied', gold: 'entails', slice: 'vague', domain: 'Academics', productCaution: 'underspecified', note: 'Bare past tense entails the verb, but the log is still underspecified for credit.' },
    { id: 'N-VAGUE-STUFF', text: 'did stuff', target: 'studied', gold: 'neutral', slice: 'vague', domain: 'Academics' },
    { id: 'N-ADJ-SHOW', text: 'Watched a cooking show', target: 'cooked a meal', gold: 'neutral', slice: 'category_adjacent', domain: 'Nutrition & Cooking' },
    { id: 'N-ADJ-SHOES', text: 'Bought running shoes', target: 'went running', gold: 'neutral', slice: 'category_adjacent', domain: 'Physical Prowess' },
    { id: 'N-IMP-MOON', text: 'Lifted the moon', target: 'lifted weights', gold: 'neutral', slice: 'implausible', domain: 'Physical Prowess', productCaution: 'implausible' },
    { id: 'N-IMP-BOOKS', text: 'Read 400 books before lunch', target: 'read books', gold: 'entails', slice: 'implausible_volume', domain: 'Mind & Craft', productCaution: 'implausible_volume', unsafeIfSupports: true },
    { id: 'N-NOW', text: 'I am currently writing my lab report', target: 'started writing a lab report', gold: 'entails', slice: 'ongoing', domain: 'Academics' },
    { id: 'N-JUNK', text: 'aaaaaaaaaa', target: 'studied', gold: 'neutral', slice: 'junk', domain: 'Academics' },
    { id: 'N-JUNK-WORDS', text: 'career career career career career', target: 'advanced their career', gold: 'neutral', slice: 'junk', domain: 'Career' },
  ];
  return specs.map((spec) =>
    row({
      ...spec,
      source: 'stage5_new',
      group: 'new',
    })
  );
}

export function buildStage5Examples(): Stage5Example[] {
  const examples: Stage5Example[] = [];

  for (const fam of GEOMETRY_FAMILIES) {
    const target = fam.states.shortCompleted;
    for (const state of Object.keys(GOLD_BY_STATE) as StateKey[]) {
      const gold = GOLD_BY_STATE[state];
      examples.push(
        row({
          id: `${fam.id}.${state}`,
          text: fam.states[state],
          target,
          gold,
          slice: state === 'shortCompleted' ? 'paraphrase' : state,
          source: 'stage4_geometry',
          group: STATE56.has(state) ? 'state56' : 'geometry_extra',
          domain: fam.domain,
        })
      );
    }
  }

  for (const fam of NEGATION_PROBE) {
    const target = targetFromFirstPerson(fam.done);
    const states: Array<['done' | 'negated' | 'future' | 'almost', string, NliGold, string]> = [
      ['done', fam.done, 'entails', 'completed'],
      ['negated', fam.negated, 'contradicts', 'negation'],
      ['future', fam.future, 'neutral', 'future'],
      ['almost', fam.almost, 'neutral', 'almost'],
    ];
    for (const [key, text, gold, slice] of states) {
      examples.push(
        row({
          id: `${fam.id}.${key}`,
          text,
          target,
          gold,
          slice,
          source: 'stage2_negation_probe',
          group: 'state56',
          domain: fam.domain,
        })
      );
    }
  }

  for (const item of FALSE_CREDIT_SAFETY) {
    const spec = FALSE_CREDIT_TARGETS[item.id];
    if (!spec) throw new Error(`Missing false-credit target for ${item.id}`);
    examples.push(
      row({
        id: item.id,
        text: item.text,
        target: spec.target,
        gold: spec.gold,
        slice: spec.slice,
        source: 'stage2_false_credit',
        group: 'falseCredit',
        domain: item.domain,
        productCaution: spec.productCaution,
        note: spec.note ?? item.notes,
        unsafeIfSupports: spec.gold === 'entails' ? true : undefined,
      })
    );
  }

  for (const item of SHORT_VALID) {
    const spec = SHORT_VALID_TARGETS[item.id];
    if (!spec) throw new Error(`Missing short-valid target for ${item.id}`);
    examples.push(
      row({
        id: item.id,
        text: item.text,
        target: spec.target,
        gold: 'entails',
        slice: spec.slice,
        source: 'stage2_short_valid',
        group: 'shortValid',
        domain: item.domain,
        unsafeIfSupports: false,
      })
    );
  }

  for (const item of STAGE3_NEW) {
    if (item.split === 'train') continue;
    const spec = STAGE3_TARGETS[item.id];
    if (!spec) throw new Error(`Missing stage3 target for ${item.id}`);
    examples.push(
      row({
        id: item.id,
        text: item.text,
        target: spec.target,
        gold: spec.gold,
        slice: spec.slice,
        source: 'stage3_holdout',
        group: 'stage3',
        domain: item.domain,
      })
    );
  }

  examples.push(...newExamples());

  const ids = new Set<string>();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`Duplicate stage5 id ${example.id}`);
    ids.add(example.id);
    if (!example.target || !example.hypothesis.startsWith('The person already ')) {
      throw new Error(`Bad hypothesis for ${example.id}`);
    }
  }
  return examples;
}

export const SANITY_PAIRS: Array<{ id: string; text: string; hypothesis: string; gold: NliGold }> = [
  {
    id: 'SANITY-ENTAIL',
    text: 'I went to the gym and finished the workout.',
    hypothesis: 'The person already went to the gym.',
    gold: 'entails',
  },
  {
    id: 'SANITY-CONTRADICT',
    text: "I didn't go to the gym.",
    hypothesis: 'The person already went to the gym.',
    gold: 'contradicts',
  },
  {
    id: 'SANITY-NEUTRAL',
    text: 'The weather was cloudy.',
    hypothesis: 'The person already went to the gym.',
    gold: 'neutral',
  },
];
