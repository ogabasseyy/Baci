import { expect, it } from 'vitest';
import { singleWordDiscoveryTerm } from './single-word-discovery-term';

it.each(['work', 'work?', 'work:', '"work"', ' work; '])(
  'classifies a punctuated one-word query: %s', (query) => {
    expect(singleWordDiscoveryTerm(query)).toBe('work');
  }
);

it.each(['for work', 'macbook pro', '15C', ''])('leaves other queries unclassified: %s', (query) => {
  expect(singleWordDiscoveryTerm(query)).toBeUndefined();
});

it.each(['HP', 'LG', 'HP?'])('recognizes short known brand %s', (query) => {
  expect(singleWordDiscoveryTerm(query)).toBe(query.toLowerCase().replace('?', ''));
});
