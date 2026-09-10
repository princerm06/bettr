/**
 * Frozen family-level split for Candidate #3A.
 * Validation families were chosen for domain coverage and difficult contrasts.
 * Do not move a family across splits after this freeze.
 */
export const VALIDATION_FAMILY_IDS = [
  'physical.swim_set_vs_soak',
  'fashion.drape_experiment_vs_impulse_buy',
  'appearance.hygiene_closeout_vs_splash',
  'academics.flashcards_vs_background_tv',
  'career.feedback_session_vs_job_board_refresh',
  'finance.quote_rate_vs_found_cash',
  'nutrition.technique_drill_vs_eat_bar',
  'social.feedback_pref_vs_background_stream',
  'craft.solder_repair_vs_buy_earbuds',
  'wellbeing.box_breathing_vs_stare',
  'spiritual.intention_fast_vs_lobby',
  'ordinary.errands',
] as const;

export const VALIDATION_FAMILY_SET = new Set<string>(VALIDATION_FAMILY_IDS);
