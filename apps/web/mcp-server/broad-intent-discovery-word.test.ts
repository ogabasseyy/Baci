import { expect, it } from 'vitest';
import { isBroadIntentDiscoveryWord } from './broad-intent-discovery-word';

it.each([
  'work', 'gaming', 'office', 'school', 'home', 'travel', 'business',
  'student', 'photography', 'budget', 'gift',
])('flags a broad use-case word: %s', (term) => {
  expect(isBroadIntentDiscoveryWord(term)).toBe(true);
});

it.each(['WORK', 'Gifts', 'homes', 'works'])('normalizes case and plurals: %s', (term) => {
  expect(isBroadIntentDiscoveryWord(term)).toBe(true);
});

it.each(['diffuser', 'laptop', 'camera', 'phone', 'glass', 'bus', '', undefined])(
  'leaves product words unflagged: %s', (term) => {
    expect(isBroadIntentDiscoveryWord(term)).toBe(false);
  }
);
