import { describe, expect, it } from 'vitest';
import { reconcilePaystackUnmatchedPartialArgsSchema } from './reconcile-paystack-unmatched-partial';

describe('reconcilePaystackUnmatchedPartialArgsSchema', () => {
  it('accepts all operator identity and payment review inputs', () => {
    const result = reconcilePaystackUnmatchedPartialArgsSchema.safeParse({
      '--review-id': '11111111-1111-4111-8111-111111111111',
      '--canonical-order-id': '22222222-2222-4222-8222-222222222222',
      '--merchant-id': '33333333-3333-4333-8333-333333333333',
      '--operator-user-id': '44444444-4444-4444-8444-444444444444',
      '--paystack-reference': 'paystack-reference-1',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid review identity before database access', () => {
    const result = reconcilePaystackUnmatchedPartialArgsSchema.safeParse({
      '--review-id': 'not-a-uuid',
      '--canonical-order-id': '22222222-2222-4222-8222-222222222222',
      '--merchant-id': '33333333-3333-4333-8333-333333333333',
      '--operator-user-id': '44444444-4444-4444-8444-444444444444',
      '--paystack-reference': 'paystack-reference-1',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ['--canonical-order-id', 'not-a-uuid'],
    ['--merchant-id', 'not-a-uuid'],
    ['--operator-user-id', 'not-a-uuid'],
    ['--paystack-reference', ''],
  ])('rejects an invalid %s before database access', (flag, value) => {
    const result = reconcilePaystackUnmatchedPartialArgsSchema.safeParse({
      '--review-id': '11111111-1111-4111-8111-111111111111',
      '--canonical-order-id': '22222222-2222-4222-8222-222222222222',
      '--merchant-id': '33333333-3333-4333-8333-333333333333',
      '--operator-user-id': '44444444-4444-4444-8444-444444444444',
      '--paystack-reference': 'paystack-reference-1',
      [flag]: value,
    });

    expect(result.success).toBe(false);
  });

  it('accepts the explicit reviewed email-mismatch override flag', () => {
    const result = reconcilePaystackUnmatchedPartialArgsSchema.safeParse({
      '--review-id': '11111111-1111-4111-8111-111111111111',
      '--canonical-order-id': '22222222-2222-4222-8222-222222222222',
      '--merchant-id': '33333333-3333-4333-8333-333333333333',
      '--operator-user-id': '44444444-4444-4444-8444-444444444444',
      '--paystack-reference': 'paystack-reference-1',
      '--allow-email-mismatch': 'true',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized email-mismatch override value', () => {
    const result = reconcilePaystackUnmatchedPartialArgsSchema.safeParse({
      '--review-id': '11111111-1111-4111-8111-111111111111',
      '--canonical-order-id': '22222222-2222-4222-8222-222222222222',
      '--merchant-id': '33333333-3333-4333-8333-333333333333',
      '--operator-user-id': '44444444-4444-4444-8444-444444444444',
      '--paystack-reference': 'paystack-reference-1',
      '--allow-email-mismatch': 'false',
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown flags instead of stripping them', () => {
    const result = reconcilePaystackUnmatchedPartialArgsSchema.safeParse({
      '--review-id': '11111111-1111-4111-8111-111111111111',
      '--canonical-order-id': '22222222-2222-4222-8222-222222222222',
      '--merchant-id': '33333333-3333-4333-8333-333333333333',
      '--operator-user-id': '44444444-4444-4444-8444-444444444444',
      '--paystack-reference': 'paystack-reference-1',
      '--unexpected-flag': 'value',
    });

    expect(result.success).toBe(false);
  });
});
