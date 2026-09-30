/** Stage 3 experimental examples. Manual, not cloned from v1 / Stage 2 audit sets. */

export type ThreeALabel = 'DEVELOPMENTAL' | 'NON_DEVELOPMENTAL' | 'UNCERTAIN';
export type AeLabel = 'ACTION_POSITIVE' | 'ACTION_NEGATIVE' | 'AMBIGUOUS';
export type Stage3Split = 'train' | 'family_holdout' | 'contrastive_holdout';

export type Stage3Example = {
  id: string;
  text: string;
  familyId: string;
  domain: string;
  split: Stage3Split;
  threeA: ThreeALabel;
  ae: AeLabel;
  state: string;
  source: 'manual_stage3';
};

function row(
  id: string,
  familyId: string,
  domain: string,
  split: Stage3Split,
  text: string,
  threeA: ThreeALabel,
  ae: AeLabel,
  state: string
): Stage3Example {
  return { id, text, familyId, domain, split, threeA, ae, state, source: 'manual_stage3' };
}

export const STAGE3_NEW: Stage3Example[] = [
  // --- train: biochem cards (not ochem videos / not "studied calculus") ---
  row('S3-001', 'academics.biochem_cards', 'Academics', 'train', 'Ran my biochem pathway cards until I could say them without flipping', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-002', 'academics.biochem_cards', 'Academics', 'train', 'did some anki for biochem', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short_casual'),
  row('S3-003', 'academics.biochem_cards', 'Academics', 'train', 'Rewrote the urea-cycle steps in my own words', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
  row('S3-004', 'academics.biochem_cards', 'Academics', 'train', 'Skipped the card pile and just stared at the wall', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'negation_implicit'),
  row('S3-005', 'academics.biochem_cards', 'Academics', 'train', 'Tonight I start the pathway deck for real', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future_implicit'),
  row('S3-006', 'academics.biochem_cards', 'Academics', 'train', 'Came this close to opening Anki and then opened a meme page', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'almost'),
  row('S3-007', 'academics.biochem_cards', 'Academics', 'train', 'I want to finally get serious about metabolism', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-008', 'academics.biochem_cards', 'Academics', 'train', 'Binged a documentary about labs while eating cereal', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-009', 'academics.biochem_cards', 'Academics', 'train', 'Bought a new pack of index cards and left them wrapped', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-010', 'academics.biochem_cards', 'Academics', 'train', 'School stuff', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-011', 'career.cover_letter_pass', 'Career', 'train', 'Cut 80 words from a cover letter and sent it', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-012', 'career.cover_letter_pass', 'Career', 'train', 'tweaked my cover letter', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-013', 'career.cover_letter_pass', 'Career', 'train', 'Never hit send on the draft sitting in my tabs', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'negation_implicit'),
  row('S3-014', 'career.cover_letter_pass', 'Career', 'train', 'This weekend is when I finally apply everywhere', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future_implicit'),
  row('S3-015', 'career.cover_letter_pass', 'Career', 'train', 'Hovered over submit for ten minutes and closed the laptop', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'almost'),
  row('S3-016', 'career.cover_letter_pass', 'Career', 'train', 'Planning a big application sprint', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'plan'),
  row('S3-017', 'career.cover_letter_pass', 'Career', 'train', 'Watched a video about crushing interviews', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-018', 'career.cover_letter_pass', 'Career', 'train', 'Opened the careers portal and bounced', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'related_not_completed'),
  row('S3-019', 'career.cover_letter_pass', 'Career', 'train', 'Career grind', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-020', 'finance.envelope_tally', 'Finance', 'train', 'Tallied last week of coffee receipts into envelopes', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-021', 'finance.envelope_tally', 'Finance', 'train', 'updated my envelope sheet', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-022', 'finance.envelope_tally', 'Finance', 'train', 'Meant to tally receipts. Did not.', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'negation'),
  row('S3-023', 'finance.envelope_tally', 'Finance', 'train', 'Gonna get my money together starting Monday', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future_casual'),
  row('S3-024', 'finance.envelope_tally', 'Finance', 'train', 'I want to start budgeting like a real adult', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-025', 'finance.envelope_tally', 'Finance', 'train', 'Peeked at the account total and locked the phone', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'related_not_completed'),
  row('S3-026', 'finance.envelope_tally', 'Finance', 'train', 'Money stuff', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-027', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'Stir-fried tofu until the edges browned without burning the garlic', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-028', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'cooked a stir fry', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-029', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'prepped veg for the week', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-030', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'DoorDashed dumplings instead of cooking', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive_consume'),
  row('S3-031', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'New wok is on the way so I can get healthy', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-032', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'Tomorrow I cook every meal, I swear', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future'),
  row('S3-033', 'nutrition.stir_fry_skill', 'Nutrition & Cooking', 'train', 'Kitchen things', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-034', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'Washed, flossed, and put on the night cream', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-035', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'did skincare', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-036', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'flossed n washed up', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'slang'),
  row('S3-037', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'I should really start a night routine', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-038', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'Splashed water and called it a night', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'non_practice'),
  row('S3-039', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'Cleanser arrived. Still in the bag', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-040', 'appearance.night_wash', 'Appearance & Self-Care', 'train', 'Self care vibes', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-041', 'fashion.button_repair', 'Fashion & Style', 'train', 'Sewed a button back on and checked the collar in the mirror', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-042', 'fashion.button_repair', 'Fashion & Style', 'train', 'fixed the button', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-043', 'fashion.button_repair', 'Fashion & Style', 'train', 'Laid out two shirts for a presentation', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
  row('S3-044', 'fashion.button_repair', 'Fashion & Style', 'train', 'Clicked a blazer into the cart because I felt ugly', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-045', 'fashion.button_repair', 'Fashion & Style', 'train', 'Gonna start dressing like I have a job', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future'),
  row('S3-046', 'fashion.button_repair', 'Fashion & Style', 'train', 'Fit check', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-047', 'physical.hill_repeats', 'Physical Prowess', 'train', 'Did six hill repeats and walked the last one on purpose', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-048', 'physical.hill_repeats', 'Physical Prowess', 'train', 'got my lift in', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'slang_short'),
  row('S3-049', 'physical.hill_repeats', 'Physical Prowess', 'train', 'rowed 2k', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-050', 'physical.hill_repeats', 'Physical Prowess', 'train', 'Never left the couch for the session I blocked', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'negation_implicit'),
  row('S3-051', 'physical.hill_repeats', 'Physical Prowess', 'train', 'New lifting shoes so I can finally get jacked', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-052', 'physical.hill_repeats', 'Physical Prowess', 'train', 'Watched a highlight reel of other people lifting', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-053', 'physical.hill_repeats', 'Physical Prowess', 'train', 'Training arc starts after finals', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future'),
  row('S3-054', 'physical.hill_repeats', 'Physical Prowess', 'train', 'Gym stuff', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-055', 'mind.rust_kata', 'Mind & Craft', 'train', 'Worked a rust ownership kata until the borrow checker quieted', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-056', 'mind.rust_kata', 'Mind & Craft', 'train', 'practiced scales on ukulele', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-057', 'mind.rust_kata', 'Mind & Craft', 'train', 'ukulele 15 min', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'duration'),
  row('S3-058', 'mind.rust_kata', 'Mind & Craft', 'train', 'Opened the kata repo and closed it', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'related_not_completed'),
  row('S3-059', 'mind.rust_kata', 'Mind & Craft', 'train', 'Bought a nicer uke. Still in the case', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-060', 'mind.rust_kata', 'Mind & Craft', 'train', 'I wish I was the kind of person who practices daily', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-061', 'mind.rust_kata', 'Mind & Craft', 'train', 'Watched people shred on YouTube for an hour', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-062', 'mind.rust_kata', 'Mind & Craft', 'train', 'Creative mode', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-063', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'Sat and counted breaths to twenty, twice', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-064', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'box breathing 4 rounds', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short_method'),
  row('S3-065', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'wrote three lines in the night notebook', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'journal_not_bare'),
  row('S3-066', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'Felt calmer. Did not sit.', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'observation'),
  row('S3-067', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'I want to become someone who meditates', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-068', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'Had a productive, aligned day', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'vague_positivity'),
  row('S3-069', 'inner.counted_breaths', 'Inner Wellbeing', 'train', 'Wellness', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-070', 'spirit.friday_salah', 'Spirituality', 'train', 'Made jumu ah and stayed for the short talk after', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-071', 'spirit.friday_salah', 'Spirituality', 'train', 'prayed asr', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-072', 'spirit.friday_salah', 'Spirituality', 'train', 'read a page of a commentary and sat with it', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
  row('S3-073', 'spirit.friday_salah', 'Spirituality', 'train', 'Been meaning to get back to prayer', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-074', 'spirit.friday_salah', 'Spirituality', 'train', 'Scrolling sermons in bed', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-075', 'spirit.friday_salah', 'Spirituality', 'train', 'Faith stuff', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-076', 'social.checkin_ra', 'Social', 'train', 'Texted my RA a real check-in, not just a meme', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-077', 'social.checkin_ra', 'Social', 'train', 'called my sister and actually listened', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-078', 'social.checkin_ra', 'Social', 'train', 'I should reach out more', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-079', 'social.checkin_ra', 'Social', 'train', 'Lurked the group chat and sent nothing', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-080', 'social.checkin_ra', 'Social', 'train', 'People things', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  row('S3-081', 'ordinary.sink_vs_scroll', 'Ordinary / none', 'train', 'Washed the dishes and wiped the counters', 'NON_DEVELOPMENTAL', 'ACTION_POSITIVE', 'ordinary_action'),
  row('S3-082', 'ordinary.sink_vs_scroll', 'Ordinary / none', 'train', 'My sink looks nicer', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'observation'),
  row('S3-083', 'ordinary.sink_vs_scroll', 'Ordinary / none', 'train', 'Took the recycling down', 'NON_DEVELOPMENTAL', 'ACTION_POSITIVE', 'ordinary_action'),
  row('S3-084', 'ordinary.sink_vs_scroll', 'Ordinary / none', 'train', 'Give me points for existing today', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'gaming'),
  row('S3-085', 'ordinary.sink_vs_scroll', 'Ordinary / none', 'train', 'progress growth discipline career academic productive', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'stuffing'),
  row('S3-086', 'ordinary.sink_vs_scroll', 'Ordinary / none', 'train', 'Deadlifted a city bus for breakfast', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'implausible'),

  row('S3-087', 'academics.typo_hw', 'Academics', 'train', 'fnished the discrete worksheet', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'typo'),
  row('S3-088', 'academics.typo_hw', 'Academics', 'train', 'proofed two induction problems', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-089', 'academics.typo_hw', 'Academics', 'train', 'Homework later, maybe', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future'),
  row('S3-090', 'career.mock_standup', 'Career', 'train', 'Ran a 5-minute mock standup out loud', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
  row('S3-091', 'career.mock_standup', 'Career', 'train', 'starred a hiring post and closed the app', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'related_not_completed'),
  row('S3-092', 'finance.bill_calendar', 'Finance', 'train', 'Put due dates on a bill calendar and checked two against statements', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-093', 'finance.bill_calendar', 'Finance', 'train', 'Paid the usual wifi bill on autopay ping', 'NON_DEVELOPMENTAL', 'ACTION_POSITIVE', 'ordinary_admin'),

  // --- family holdout: bouldering (not "gym") ---
  row('S3-H01', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Worked the same orange V2 until I stuck the last move', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-H02', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'bouldered 40 min', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'duration'),
  row('S3-H03', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Never got off the bench under the wall', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'negation_implicit'),
  row('S3-H04', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Next month I start climbing seriously', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future'),
  row('S3-H05', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Chalk bag is new. Hands never touched rock', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-H06', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Watched a send video in bed', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-H07', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Climbing things', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),
  row('S3-H08', 'hold.bouldering', 'Physical Prowess', 'family_holdout', 'Came within one try and packed up instead', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'almost'),

  // --- family holdout: woodworking ---
  row('S3-H09', 'hold.woodworking', 'Mind & Craft', 'family_holdout', 'Squared a small box lid and sanded the corners even', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-H10', 'hold.woodworking', 'Mind & Craft', 'family_holdout', 'sanded for 20 min', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'duration'),
  row('S3-H11', 'hold.woodworking', 'Mind & Craft', 'family_holdout', 'The shop looked productive. I watched from the door', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'observation'),
  row('S3-H12', 'hold.woodworking', 'Mind & Craft', 'family_holdout', 'I will mill lumber this summer', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future'),
  row('S3-H13', 'hold.woodworking', 'Mind & Craft', 'family_holdout', 'Bought a fancy chisel set for the person I want to be', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'purchase'),
  row('S3-H14', 'hold.woodworking', 'Mind & Craft', 'family_holdout', 'Workshop mode', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  // --- family holdout: evening dhikr-like but not "prayed 10 min" ---
  row('S3-H15', 'hold.evening_liturgy', 'Spirituality', 'family_holdout', 'Read the evening office slowly and stayed for the silence after', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed_detailed'),
  row('S3-H16', 'hold.evening_liturgy', 'Spirituality', 'family_holdout', 'said the evening prayers', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'short'),
  row('S3-H17', 'hold.evening_liturgy', 'Spirituality', 'family_holdout', 'I keep telling myself I will get spiritually consistent', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'desire'),
  row('S3-H18', 'hold.evening_liturgy', 'Spirituality', 'family_holdout', 'Podcast about mystics while doing dishes', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'passive'),
  row('S3-H19', 'hold.evening_liturgy', 'Spirituality', 'family_holdout', 'Spirit work', 'UNCERTAIN', 'AMBIGUOUS', 'vague'),

  // --- contrastive holdout: constructions not used as a cookie-cutter in train ---
  row('S3-C01', 'hold.implicit_tense', 'Academics', 'contrastive_holdout', 'The problem set is a tomorrow-me problem', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'future_implicit'),
  row('S3-C02', 'hold.implicit_tense', 'Career', 'contrastive_holdout', 'Application is sitting in drafts collecting dust', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'negation_implicit'),
  row('S3-C03', 'hold.implicit_tense', 'Physical Prowess', 'contrastive_holdout', 'Session existed only on my calendar', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'almost_plan'),
  row('S3-C04', 'hold.implicit_tense', 'Nutrition & Cooking', 'contrastive_holdout', 'Groceries became takeout again', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'failed_intention'),
  row('S3-C05', 'hold.implicit_tense', 'Inner Wellbeing', 'contrastive_holdout', 'Sat down to sit and immediately stood up for snacks', 'NON_DEVELOPMENTAL', 'ACTION_NEGATIVE', 'almost'),
  row('S3-C06', 'hold.implicit_tense', 'Academics', 'contrastive_holdout', 'Worked two old midterm questions with the answers covered', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
  row('S3-C07', 'hold.implicit_tense', 'Social', 'contrastive_holdout', 'Asked a classmate one follow-up after section', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
  row('S3-C08', 'hold.implicit_tense', 'Finance', 'contrastive_holdout', 'Tagged three subscriptions I actually cancelled', 'DEVELOPMENTAL', 'ACTION_POSITIVE', 'completed'),
];
