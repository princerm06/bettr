/**
 * Static Friend Activity presentation checks.
 * Presentation/read path only — does not change privacy, visibility, or scoring.
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');

const friendsViewStart = page.indexOf('function FriendsView(');
assert.ok(friendsViewStart >= 0, 'FriendsView missing');
const friendsView = page.slice(friendsViewStart);

const feedMapStart = friendsView.indexOf('{feed.map((entry) => {');
assert.ok(feedMapStart >= 0, 'Friend Activity feed map missing');
const feedBlock = friendsView.slice(feedMapStart, feedMapStart + 2500);

assert.ok(
  feedBlock.includes('categoriesForLog({'),
  'Friend Activity must resolve categories via categoriesForLog'
);
assert.ok(
  feedBlock.includes('categories: entry.categories'),
  'Friend Activity must read entry.categories'
);
assert.ok(
  feedBlock.includes(".join(' · ')"),
  'Friend Activity must render all accepted categories with the history separator'
);
assert.ok(
  feedBlock.includes('categoryFor(key).emoji') &&
    feedBlock.includes('categoryFor(key).short'),
  'Friend Activity must use canonical emoji + short labels'
);
assert.ok(
  !/visibility\s*=\s*['"]private['"]/.test(feedBlock),
  'Friend Activity render path must not rewrite private visibility'
);
assert.ok(
  !feedBlock.includes('evaluateObviousCategoryMismatch'),
  'Friend Activity must not invoke semantic mismatch evaluation'
);
assert.ok(
  !feedBlock.includes('applyPriorityReward'),
  'Friend Activity must not invoke priority/XP scoring'
);

const feedQuery = friendsView.includes(".eq('visibility', 'friends')");
assert.ok(feedQuery, 'Friend Activity feed query must stay friends-visibility scoped');

console.log(
  JSON.stringify(
    {
      ok: true,
      surface: 'friend-activity-categories',
      presentationOnly: true,
    },
    null,
    2
  )
);
