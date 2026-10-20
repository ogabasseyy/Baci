import { expect, it } from 'vitest';
import { matchesValidatedResume } from './CheckoutCartScreen';
it('does not treat a query parameter as an authorized order', () => {
  expect(matchesValidatedResume(null, 'untrusted-order')).toBe(false);
});
it('rejects an old validated result after the requested order changes', () => {
  expect(
    matchesValidatedResume({ id: 'previous-order' }, 'untrusted-order')
  ).toBe(false);
});
it('permits the successfully loaded order matching the current request', () => {
  expect(
    matchesValidatedResume({ id: 'validated-order' }, 'validated-order')
  ).toBe(true);
});
