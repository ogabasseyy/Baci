import { describe, expect, it } from 'vitest';
import { redvaultTestQuote } from '@/lib/checkout/redvault-test-fixture';
import { redvaultProofContextSchema } from './redvault-proof-context';

const context = {
  applicationId: '22222222-2222-4222-8222-222222222222',
  taxBasis: 'exclusive',
  discountKobo: 1000,
  eligibleSubtotalKobo: 10000,
  productSubtotalKobo: 10000,
  groups: redvaultTestQuote.groups.map((group) => ({
    ...group,
    members: group.members.map((member) => ({
      ...member,
      orderItemId: '33333333-3333-4333-8333-333333333333',
    })),
  })),
};
describe('redvault proof context', () => {
  it('accepts a persisted item binding', () =>
    expect(redvaultProofContextSchema.safeParse(context).success).toBe(true));
  it.each([
    { ...context, taxBasis: 'inclusive' },
    { ...context, groups: redvaultTestQuote.groups },
    { ...context, discountKobo: -1 },
    { ...context, productSubtotalKobo: null },
  ])('rejects incomplete or invalid context', (value) =>
    expect(redvaultProofContextSchema.safeParse(value).success).toBe(false));
});
