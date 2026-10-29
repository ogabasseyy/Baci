import { expect, it } from 'vitest';
import { catalogEntry } from './check-catalog-types';

it('keeps the supplied question and scope, including empty associations', () => {
  expect(
    catalogEntry('Model', 'Which device?', 'details', [], [], [])
  ).toEqual({
    name: 'Model',
    question: 'Which device?',
    goal: 'details',
    brands: [],
    devices: [],
    relatedTierKeys: [],
  });
});

it('retains a populated catalog scope and related service tier', () => {
  expect(
    catalogEntry(
      'Model',
      'Which device?',
      'details',
      ['apple'],
      ['smartphone'],
      ['basic']
    )
  ).toEqual({
    name: 'Model',
    question: 'Which device?',
    goal: 'details',
    brands: ['apple'],
    devices: ['smartphone'],
    relatedTierKeys: ['basic'],
  });
});
