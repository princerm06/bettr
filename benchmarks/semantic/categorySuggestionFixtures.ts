import type { CategoryKey } from '../../lib/evaluation/legacyEvaluator';

export type CategorySuggestionFixture = {
  id: string;
  text: string;
  selected?: CategoryKey[];
  mustInclude?: CategoryKey[];
  mustExclude?: CategoryKey[];
  allowEmpty?: boolean;
};

export const CATEGORY_SUGGESTION_FIXTURES: CategorySuggestionFixture[] = [
  {
    id: 'M1',
    text: 'Went to Walmart and bought skincare and a new suit',
    mustInclude: ['appearance', 'fashion'],
  },
  {
    id: 'M2',
    text: 'Worked on my resume and studied calculus',
    mustInclude: ['career', 'academics'],
  },
  {
    id: 'M3',
    text: 'Meal prepped and tracked my grocery spending',
    mustInclude: ['nutrition', 'finance'],
  },
  {
    id: 'S1',
    text: 'Bought a new suit',
    mustInclude: ['fashion'],
    mustExclude: ['appearance'],
  },
  {
    id: 'S2',
    text: 'Did my skincare routine',
    mustInclude: ['appearance'],
  },
  {
    id: 'S3',
    text: 'Studied for my calculus exam',
    mustInclude: ['academics'],
  },
  {
    id: 'S4',
    text: 'Applied to three internships',
    mustInclude: ['career'],
  },
  {
    id: 'S5',
    text: 'Ran 5 miles',
    mustInclude: ['physical'],
  },
  {
    id: 'Y1',
    text: 'Put together a business casual look',
    mustInclude: ['fashion'],
  },
  {
    id: 'Y2',
    text: 'Polished my portfolio for recruiters',
    mustInclude: ['career'],
  },
  {
    id: 'Y3',
    text: 'Did mobility work after lifting',
    mustInclude: ['physical'],
  },
  {
    id: 'Y4',
    text: 'Reviewed my monthly expenses',
    mustInclude: ['finance'],
    mustExclude: ['academics'],
  },
  {
    id: 'N1',
    text: 'Bought groceries at Walmart',
    mustExclude: ['fashion', 'appearance', 'physical'],
  },
  {
    id: 'N2',
    text: 'Watched Netflix',
    allowEmpty: true,
    mustExclude: ['fashion', 'appearance', 'career', 'academics'],
  },
  {
    id: 'N3',
    text: 'Went outside',
    allowEmpty: true,
    mustExclude: ['fashion', 'career', 'academics'],
  },
  {
    id: 'X1',
    text: 'Ran 5 miles',
    selected: ['physical'],
    mustExclude: ['physical'],
  },
  {
    id: 'R-A',
    text: 'Bought skincare and a suit',
    mustInclude: ['appearance', 'fashion'],
  },
  {
    id: 'R-B',
    text: 'Picked up skincare and a blazer',
    mustInclude: ['appearance', 'fashion'],
  },
  {
    id: 'R-C',
    text: 'Got face wash and a new jacket',
    mustInclude: ['fashion'],
  },
  {
    id: 'R-D',
    text: 'Bought a business casual outfit',
    mustInclude: ['fashion'],
  },
  {
    id: 'R-E',
    text: 'Went shopping for skincare and clothes',
    mustInclude: ['appearance', 'fashion'],
  },
  {
    id: 'R-F',
    text: 'Bought groceries and toothpaste',
    allowEmpty: true,
    mustExclude: ['fashion'],
  },
  {
    id: 'R-G',
    text: 'Went shopping at Walmart',
    allowEmpty: true,
  },
  {
    id: 'R-H',
    text: 'Bought household supplies',
    allowEmpty: true,
  },
  {
    id: 'R-I',
    text: 'Picked up shampoo and groceries',
    allowEmpty: true,
    mustExclude: ['fashion'],
  },
];
