import type { BettrV1Category } from './types';

export const BETTR_V1_CATEGORIES: BettrV1Category[] = [
  'Appearance & Self-Care',
  'Fashion & Style',
  'Academics',
  'Career',
  'Finance',
  'Nutrition & Cooking',
  'Social',
  'Physical Prowess',
  'Mind & Craft',
  'Inner Wellbeing',
  'Spirituality',
];

export const CATEGORY_DEFINITIONS: Record<BettrV1Category, string> = {
  'Appearance & Self-Care':
    'Deliberate actions that improve or maintain personal grooming, hygiene, skincare, haircare, physical appearance, presentation, or other appearance-related self-care.',
  'Fashion & Style':
    'Deliberate actions that develop, improve, or express personal style through outfit creation, wardrobe building, clothing coordination, accessories, fashion knowledge, or intentional experimentation with how one presents themselves. Merely acquiring an item is not necessarily progress.',
  'Academics':
    'Deliberate learning or work connected to formal education, including coursework, studying, assignments, exams, academic projects, academic research, or improving academic performance.',
  'Career':
    'Deliberate actions that develop professional skills, employability, job or internship readiness, professional experience, networking, applications, interviewing ability, professional projects, or long-term career advancement.',
  'Finance':
    'Deliberate actions that improve the person\'s ability to earn, create, manage, save, invest, grow, or make informed decisions with money, including freelancing, side hustles, entrepreneurship, budgeting, investing, and personal financial management. Simply receiving money is not automatically developmental progress.',
  'Nutrition & Cooking':
    'Deliberate actions that improve nutrition, eating habits, meal planning, food preparation, cooking ability, or practical knowledge about food and nutrition.',
  'Social':
    'Deliberate actions that develop communication, interpersonal skills, social confidence, relationship-building ability, networking ability, or meaningful social participation.',
  'Physical Prowess':
    'Deliberate exercise, practice, or training that develops or maintains strength, endurance, mobility, conditioning, athletic performance, movement skill, or other physical capabilities.',
  'Mind & Craft':
    'Deliberate intellectual, creative, or skill-building activity outside formal academics and direct professional development, including reading, writing, music, language learning, philosophy, creative work, crafts, and practicing personal skills or hobbies.',
  'Inner Wellbeing':
    'Deliberate actions that develop or maintain emotional wellbeing, mindfulness, self-awareness, self-reflection, stress management, resilience, mental clarity, or healthy psychological habits.',
  'Spirituality':
    'Deliberate actions that develop, practice, explore, or deepen spirituality, religion, faith, spiritual values, contemplation, or a person\'s relationship with spiritual meaning.',
};

export const CATEGORY_NLI_HYPOTHESES: Record<BettrV1Category, string> = {
  'Appearance & Self-Care':
    'This activity meaningfully contributes to the person\'s grooming, hygiene, appearance, or personal self-care.',
  'Fashion & Style':
    'This activity meaningfully contributes to the person\'s personal style, outfit creation, wardrobe development, clothing coordination, or fashion ability.',
  'Academics':
    'This activity meaningfully contributes to the person\'s academic learning, coursework, studying, or academic performance.',
  'Career':
    'This activity meaningfully contributes to the person\'s professional skills, employability, job readiness, or career development.',
  'Finance':
    'This activity meaningfully contributes to the person\'s ability to earn, create, manage, save, invest, grow, or make informed decisions with money.',
  'Nutrition & Cooking':
    'This activity meaningfully contributes to the person\'s nutrition, eating habits, meal preparation, or cooking ability.',
  'Social':
    'This activity meaningfully contributes to the person\'s communication, relationships, social confidence, networking, or interpersonal ability.',
  'Physical Prowess':
    'This activity meaningfully contributes to the person\'s strength, endurance, fitness, athletic ability, movement skill, or physical capability.',
  'Mind & Craft':
    'This activity meaningfully contributes to the person\'s intellectual, creative, or personal skill development outside formal academics and direct professional development.',
  'Inner Wellbeing':
    'This activity meaningfully contributes to the person\'s emotional wellbeing, mindfulness, self-reflection, resilience, stress management, or mental clarity.',
  'Spirituality':
    'This activity meaningfully contributes to the person\'s spiritual or religious practice, faith, contemplation, values, or spiritual development.',
};

export const DEVELOPMENTAL_HYPOTHESES = {
  developmental:
    'This describes a deliberate action that meaningfully develops, improves, practices, expresses, or maintains an aspect of the person\'s capabilities or wellbeing.',
  ordinary:
    'This describes an ordinary life activity without a meaningful self-development action.',
  passive:
    'This mainly describes passive consumption or exposure rather than meaningful practice, learning, improvement, or reflection.',
} as const;

export const AMBIGUITY_HYPOTHESES = {
  clear:
    'The activity is clear enough to understand what meaningful action the person took.',
  unclear:
    'Important information is missing, so it is unclear what meaningful action the person actually took.',
} as const;

export const NONSENSE_HYPOTHESES = {
  plausible:
    'This describes an action that is physically or realistically plausible for a person.',
  nonsense:
    'This contains an obviously impossible, nonsensical, or structurally unrealistic accomplishment.',
} as const;
