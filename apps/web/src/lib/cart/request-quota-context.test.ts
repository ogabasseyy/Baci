import { expect, it } from 'vitest';
import { createCartQuotaRequestContext } from './request-quota-context';

it('keeps degradation and time budgets isolated between requests', () => {
  const first = createCartQuotaRequestContext('available');
  const next = createCartQuotaRequestContext('available');
  first.degraded = true;
  first.remainingMs = 0;
  expect(next.degraded).toBe(false);
  expect(next.remainingMs).toBeGreaterThan(0);
  expect(createCartQuotaRequestContext('required').remainingMs).toBeGreaterThan(
    next.remainingMs
  );
});
