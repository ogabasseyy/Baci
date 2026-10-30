import { expect, it } from 'vitest';
import { addressBudgetRequestSchema } from './address-budget-request';

const valid = {
  provider: 'google',
  kind: 'autocomplete',
  apiKey: 'synthetic-key',
  reservationId: '00000000-0000-4000-8000-000000000001',
};
it('accepts a captured credential and rejects mismatched provider operations', () => {
  expect(addressBudgetRequestSchema.safeParse(valid).success).toBe(true);
  for (const data of [
    { ...valid, apiKey: '' },
    { ...valid, apiKey: ' padded ' },
    { ...valid, reservationId: 'not-a-uuid' },
    { ...valid, provider: 'untracked' },
    { ...valid, provider: 'geoapify', kind: 'details' },
  ])
    expect(addressBudgetRequestSchema.safeParse(data).success).toBe(false);
});
