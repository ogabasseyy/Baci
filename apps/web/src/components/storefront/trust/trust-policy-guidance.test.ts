import { expect, it } from 'vitest';
import { getPolicyGuidance } from './trust-policy-guidance';

const profile = { socialLinks: {}, derivedLinks: {} };

it('uses support guidance when the merchant has no configured return policy', () => {
  expect(getPolicyGuidance('returns', 'Merchant', profile).heading).toBe(
    'Before you contact support about a return'
  );
});

it.each([
  { kind: 'shipping' as const, heading: 'How delivery works' },
  { kind: 'warranty' as const, heading: 'How warranty support works' },
])('uses the appropriate guidance for $kind', ({ kind, heading }) => {
  expect(getPolicyGuidance(kind, 'Merchant', profile).heading).toBe(heading);
});
