import { expect, it } from 'vitest';
import { matchesValidatedResume } from './checkout-resume-match';

it('matches only the requested validated order', () => {
  expect(matchesValidatedResume({ id: 'order-1' }, 'order-1')).toBe(true);
  expect(matchesValidatedResume({ id: 'order-1' }, 'order-2')).toBe(false);
  expect(matchesValidatedResume(null, 'order-1')).toBe(false);
  expect(matchesValidatedResume({ id: 'order-1' }, null)).toBe(false);
});
