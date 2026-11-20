import { describe, expect, it } from 'vitest';
import { evidenceSchema } from './partner-reconciliation-evidence';

const capture = {
  source: 'example_provider',
  provider_account: 'buyer-provider-account',
  reference: 'paid-reference',
  amount_minor: 171200,
  currency: 'NGN',
  captured_at: '2026-11-20T14:00:00Z',
};
const evidence = {
  submission_id: '20000000-0000-4000-8000-000000000001',
  quote_id: '20000000-0000-4000-8000-000000000002',
  partner_order_id: 'example-order',
  capture,
};

describe('partner reconciliation evidence schema', () => {
  it('accepts capture before settlement is available', () => {
    expect(evidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it.each([
    { ...evidence, capture: { ...capture, currency: 'USD' } },
    {
      ...evidence,
      capture: { ...capture, captured_at: '2026-11-20T14:00:00' },
    },
    { ...evidence, capture: { ...capture, provider_account: ' ' } },
    { ...evidence, capture: { ...capture, amount_minor: 0 } },
    { ...evidence, settlement: { amount_minor: 170000, currency: 'NGN' } },
  ])('rejects malformed financial evidence', (invalid) => {
    expect(evidenceSchema.safeParse(invalid).success).toBe(false);
  });
});
