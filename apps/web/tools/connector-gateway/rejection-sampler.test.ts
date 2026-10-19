import { expect, it } from 'vitest';
import { createRejectionSampler } from './rejection-sampler';

it('samples once per window and caps new client entries', () => {
  const sample = createRejectionSampler(1000, 2);
  expect(sample('a', 0)).toBe(true);
  expect(sample('a', 1)).toBe(false);
  expect(sample('b', 1)).toBe(true);
  expect(sample('c', 2)).toBe(false);
  expect(sample('c', 1002)).toBe(true);
  expect(sample('c', 1003)).toBe(false);
});
it('reclaims expired entries incrementally without requiring a full scan', () => {
  const sample = createRejectionSampler(1000, 250);
  for (let i = 0; i < 250; i++) expect(sample(String(i), 0)).toBe(true);
  expect(sample('overflow', 1)).toBe(false);
  for (let i = 0; i < 250; i++) expect(sample(`new-${i}`, 1001)).toBe(true);
});
