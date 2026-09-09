export type CategoryKey =
  | 'appearance'
  | 'fashion'
  | 'academics'
  | 'career'
  | 'finance'
  | 'nutrition'
  | 'social'
  | 'physical'
  | 'mind'
  | 'spirituality';

export type Category = {
  key: CategoryKey;
  label: string;
  short: string;
  emoji: string;
  description: string;
};

export type QualityResult = {
  status: 'valid' | 'questionable' | 'invalid';
  message: string;
  rewardRatio: number;
  matchedCategories?: CategoryKey[];
  unsupportedCategories?: CategoryKey[];
  suggestedCategory?: CategoryKey;
  suggestionMode?: 'switch' | 'add';
};

export const categories: Category[] = [
  { key: 'appearance', label: 'Appearance & Self-Care', short: 'Appearance', emoji: '🧴', description: 'Skin, hair, grooming, hygiene' },
  { key: 'fashion', label: 'Fashion & Accessories', short: 'Fashion', emoji: '👔', description: 'Wardrobe, outfits, accessories, fragrance' },
  { key: 'academics', label: 'Academics', short: 'Academics', emoji: '🎓', description: 'Studying, assignments, tests, grades' },
  { key: 'career', label: 'Career', short: 'Career', emoji: '💼', description: 'Applications, résumé, interviews, research' },
  { key: 'finance', label: 'Finance', short: 'Finance', emoji: '💰', description: 'Spending, budgeting, saving, investing, income' },
  { key: 'nutrition', label: 'Nutrition & Cooking', short: 'Nutrition', emoji: '🥗', description: 'Cooking, meal prep, nutrition, hydration' },
  { key: 'social', label: 'Socialization', short: 'Social', emoji: '🗣️', description: 'Initiation, new connections, relationships' },
  { key: 'physical', label: 'Physical Prowess', short: 'Physical', emoji: '🏋️', description: 'Running, lifting, athletics, martial arts' },
  { key: 'mind', label: 'Mind & Craft', short: 'Mind & Craft', emoji: '🧠', description: 'Reading, journaling, instruments, philosophy' },
  { key: 'spirituality', label: 'Spirituality & Faith', short: 'Spirituality', emoji: '🙏', description: 'Prayer, worship, reflection, spiritual practice' },
];

export function categoryFor(key: CategoryKey) {
  return categories.find((category) => category.key === key)!;
}

export const categorySignals: Record<CategoryKey, RegExp> = {
  appearance: /\b(skin|skincare|hair|groom|shav|hygiene|dental|teeth|face|acne|moistur|cleanser|sunscreen|trim|barber)\w*\b/,
  fashion: /\b(outfit|wardrobe|shirt|pants|shoe|jacket|style|accessor|watch|jewel|fragrance|cologne|dress)\w*\b|\bfit\b/,
  academics: /\b(stud|class|lecture|homework|assignment|quiz|exam|test|problem|leetcode|course|grade|review|learn|notes?|flashcards?|school|college|university|theorem|proof|math|algebra|calculus|biology|chemistry|physics|bio|equation|formula)\w*\b/,
  career: /\b(job|career|intern|resume|résumé|application|apply|interview|network|recruit|portfolio|project|research|linkedin|meeting|professional|app)\w*\b/,
  finance: /\b(budget|spend|spent|save|saved|saving|invest|money|dollar|income|expense|grocer|trade|stock|deposit|cash|debt|bill)\w*\b/,
  nutrition: /\b(cook|meal|food|protein|calor|nutrition|grocery|water|hydr|breakfast|lunch|dinner|vegetable|fruit|prep)\w*\b/,
  social: /\b(friend|social|talk|conversation|meet|met|hang|party|event|date|call|text|introduc|connect|plan|roommate)\w*\b/,
  physical: /\b(gym|lift|run|ran|walk|squat|bench|deadlift|workout|train|mile|km|5k|10k|rep|set|sport|basketball|soccer|mobility|stretch|cardio|pr)\w*\b/,
  mind: /\bapp\b|\b(read|book|journal|meditat|write|wrote|guitar|piano|instrument|language|chess|philosoph|practice|speech|debate|craft|draw|paint|creat|code|coding|software|program|develop|build|debug|website)\w*\b/,
  spirituality: /\b(pray|prayer|church|mosque|temple|scripture|bible|quran|faith|worship|relig|gratitude|spiritual|service|reflection)\w*\b/,
};

const progressSignals = /\b(stud(?:y|ied|ying)|learn(?:ed|ing)?|read|wrote|write|practic(?:e|ed|ing)|train(?:ed|ing)?|work(?:ed|ing)?|lift(?:ed|ing)?|ran|run(?:ning)?|walk(?:ed|ing)?|cook(?:ed|ing)?|prep(?:ped|ping)?|apply|applied|built|build(?:ing)?|finish(?:ed|ing)?|complete(?:d|ing)?|review(?:ed|ing)?|save(?:d|ing)?|invest(?:ed|ing)?|budget(?:ed|ing)?|plan(?:ned|ning)?|meet|met|talk(?:ed|ing)?|prayed|pray(?:ing)?|journal(?:ed|ing)?|meditat(?:ed|ing)|clean(?:ed|ing)?|organ(?:ize|ized|izing)|improv(?:e|ed|ing)|practice|session|workout|interview|application|assignment|project|meal|routine|class|lecture|exam|quiz|miles?|pages?|reps?|sets?|minutes?|hours?)\b/;

function looksLikeGibberish(compact: string) {
  const tokens = compact.split(' ').filter(Boolean).filter((token) => token.length > 2);
  if (!tokens.length) return true;
  const suspicious = tokens.filter((token) => {
    const letters = token.replace(/[^a-z]/g, '');
    if (letters.length < 5) return false;
    const vowels = (letters.match(/[aeiouy]/g) || []).length;
    return /[^aeiouy]{5,}/.test(letters) || vowels / letters.length < 0.16 || /(.)\1\1/.test(letters);
  }).length;
  const recognizable = progressSignals.test(compact) || Object.values(categorySignals).some((pattern) => pattern.test(compact));
  return !recognizable && (tokens.length <= 2 || suspicious >= Math.ceil(tokens.length / 2));
}

const activityProgressSignals = /\b(stud(?:y|ied|ying)|learn(?:ed|ing)?|read|wrote|write|solv(?:e|ed|ing)|practic(?:e|ed|ing)|train(?:ed|ing)?|work(?:ed|ing)?|lift(?:ed|ing)?|ran|run(?:ning)?|walk(?:ed|ing)?|cook(?:ed|ing)?|prep(?:ped|ping)?|apply|applied|built|build(?:ing)?|finish(?:ed|ing)?|complete(?:d|ing)?|review(?:ed|ing)?|save(?:d|ing)?|invest(?:ed|ing)?|budget(?:ed|ing)?|plan(?:ned|ning)?|meet|met|talk(?:ed|ing)?|prayed|pray(?:ing)?|journal(?:ed|ing)?|meditat(?:ed|ing)|clean(?:ed|ing)?|organ(?:ize|ized|izing)|improv(?:e|ed|ing)|debug(?:ged|ging)?|develop(?:ed|ing)?|created?|made|wore|styled|shaved|groomed|personal record|pr)\b/i;

export function looksLikeReferenceDump(details: string) {
  const text = details.trim();
  if (!text) return false;

  const urls = (text.match(/https?:\/\//gi) || []).length;
  const citations = (text.match(/\[\d+\]/g) || []).length;
  const latex = (text.match(/\\(?:vert|cdot|langle|rangle|frac|text|mathbb|begin|end)/g) || []).length;

  return (
    text.length > 1400 ||
    (text.length > 650 && urls >= 2) ||
    (text.length > 650 && citations >= 3) ||
    (text.length > 650 && latex >= 2)
  );
}

export function validateLogQuality(categoryKeys: CategoryKey[], activity: string, details: string): QualityResult {
  const text = `${activity} ${details}`.trim().toLowerCase();
  const compact = text.replace(/[^a-z0-9$\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const activityCompact = activity.toLowerCase().replace(/[^a-z0-9$\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const noCredit = [
    /\bjerk\w*\s*off\b/, /\bmasturbat\w*\b/, /\bdid nothing\b/, /\bdoom ?scroll\w*\b/,
    /\bscroll(?:ed|ing)? (?:tiktok|instagram|reels|shorts)\b/, /\bwatched (?:random )?(?:tiktok|reels|shorts)\b/,
  ];
  if (noCredit.some((pattern) => pattern.test(compact))) {
    return { status: 'invalid', rewardRatio: 0, message: 'This activity doesn’t appear to represent progress in the selected area, so it won’t affect your score. You can still save it to your private history.' };
  }
  if (compact.length < 4 || /^(test|asdf|lol|idk|nothing|stuff|thing|things|random|whatever)$/.test(compact) || looksLikeGibberish(compact)) {
    return { status: 'questionable', rewardRatio: 0, message: 'This entry isn’t clear enough to score confidently. Add a plain-language description of what you did, and it can count once the progress is understandable.' };
  }

  if (!activityProgressSignals.test(activityCompact)) {
    return {
      status: 'questionable',
      rewardRatio: 0,
      message: 'Describe what you actually did in the entry itself. Notes and pasted reference material can support an activity, but they cannot create progress credit on their own.',
    };
  }

  const detectedCategories = categories
    .map((item) => item.key)
    .filter((key) => categorySignals[key].test(compact));

  const activityOnly = activity
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9$\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

  const activityDetectedCategories = categories
    .map((item) => item.key)
    .filter((key) => categorySignals[key].test(activityOnly));

  const selectedActivityMatches = categoryKeys.filter((key) =>
    activityDetectedCategories.includes(key)
  );

  const obviousOutsideActivityMatch =
    activityDetectedCategories.find(
      (key) => !categoryKeys.includes(key)
    );

  if (
    obviousOutsideActivityMatch &&
    selectedActivityMatches.length === 0
  ) {
    return {
      status: 'invalid',
      rewardRatio: 0,
      message: `The activity itself clearly looks like ${
        categoryFor(obviousOutsideActivityMatch).label
      }, not the selected ${
        categoryKeys.length === 1 ? 'category' : 'categories'
      }. Switch the category before this earns progress points.`,
      suggestedCategory: obviousOutsideActivityMatch,
      suggestionMode: categoryKeys.length === 1 ? 'switch' : 'add',
    };
  }
  const matched = categoryKeys.filter((key) => detectedCategories.includes(key));
  const unsupported = categoryKeys.filter((key) => !detectedCategories.includes(key));
  const generic = /^(walked|read|studied|worked|workout|gym|ran|cooked|prayed|journaled|talked|socialized)$/i.test(activity.trim());

  if (generic && !details.trim()) {
    return {
      status: 'questionable', rewardRatio: 0.5, matchedCategories: matched, unsupportedCategories: unsupported,
      message: 'This sounds like real progress, but it is very broad. It can earn reduced credit now; add time, distance, pages, reps, topic, or what changed for full credit.',
    };
  }

  if (categoryKeys.length > 1) {
    if (matched.length === categoryKeys.length) {
      return {
        status: 'valid', rewardRatio: 1, matchedCategories: matched,
        message: 'This clearly supports all selected areas. The activity earns one capped reward that is split across them—not extra points for extra tags.',
      };
    }

    if (matched.length > 0) {
      const clear = matched.map((key) => categoryFor(key).short).join(', ');
      const unclear = unsupported.map((key) => categoryFor(key).short).join(', ');
      return {
        status: 'questionable', rewardRatio: 1, matchedCategories: matched, unsupportedCategories: unsupported,
        message: `This is clear progress and ${clear} ${matched.length === 1 ? 'fits' : 'fit'} directly. ${unclear} ${unsupported.length === 1 ? 'isn’t' : 'aren’t'} obvious from the wording, but you can keep ${unsupported.length === 1 ? 'that tag' : 'those tags'}. The total reward stays capped and is split across every selected area, so extra tags never create extra points.`,
      };
    }

    const outsideMatch = detectedCategories.find((key) => !categoryKeys.includes(key));
    if (outsideMatch) {
      return {
        status: 'questionable', rewardRatio: 0, matchedCategories: [], unsupportedCategories: categoryKeys,
        message: `The activity looks real, but it does not support the selected areas. ${categoryFor(outsideMatch).label} is the clearest match. Switch to a supported category before this earns progress credit.`,
        suggestedCategory: outsideMatch,
        suggestionMode: 'add',
      };
    }

    if (progressSignals.test(compact)) {
      return {
        status: 'questionable', rewardRatio: 0, matchedCategories: [], unsupportedCategories: categoryKeys,
        message: 'The activity sounds like progress, but none of the selected areas are supported clearly enough. Choose a category that matches what you actually did.',
      };
    }
  } else {
    const selected = categoryKeys[0];
    const selectedMatches = matched.includes(selected);
    const alternative = detectedCategories.find((key) => key !== selected);

    if (selectedMatches) {
      return { status: 'valid', rewardRatio: 1, matchedCategories: [selected], message: 'This looks clear enough to count toward the selected area.' };
    }

    if (alternative) {
      return {
        status: 'questionable', rewardRatio: 0, matchedCategories: [], unsupportedCategories: [selected],
        message: `This looks related to ${categoryFor(alternative).label}, not ${categoryFor(selected).label}. Switch categories before this entry can earn points.`,
        suggestedCategory: alternative,
        suggestionMode: 'switch',
      };
    }

    if (progressSignals.test(compact)) {
      return {
        status: 'questionable', rewardRatio: 0, matchedCategories: [], unsupportedCategories: [selected],
        message: 'This sounds like progress, but the selected category is not supported clearly enough. Choose the area that actually matches the activity.',
      };
    }
  }

  return { status: 'questionable', rewardRatio: 0, matchedCategories: matched, unsupportedCategories: unsupported, message: 'This entry doesn’t clearly describe meaningful progress yet. Add what you actually did or what improved so Bettr can score it fairly.' };
}

export function calculateLogPoints(categoryKeys: CategoryKey[], activity: string, details: string, hasImage: boolean) {
  const quality = validateLogQuality(categoryKeys, activity, details);
  const usefulDetails = Boolean(details.trim()) && !looksLikeReferenceDump(details);
  const basePoints = usefulDetails || hasImage ? 7 : 5;
  return Math.round(basePoints * quality.rewardRatio);
}
