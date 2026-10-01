import { describe, expect, it } from 'vitest';
import { parseReconcilePaystackUnmatchedPartialArgs } from './reconcile-paystack-unmatched-partial-args';

const validArgs = [
  '--review-id',
  '11111111-1111-4111-8111-111111111111',
  '--canonical-order-id',
  '22222222-2222-4222-8222-222222222222',
  '--merchant-id',
  '33333333-3333-4333-8333-333333333333',
  '--operator-user-id',
  '44444444-4444-4444-8444-444444444444',
  '--paystack-reference',
  'paystack-reference-1',
];

describe('parseReconcilePaystackUnmatchedPartialArgs', () => {
  it('parses the review and identity flags', () => {
    expect(
      parseReconcilePaystackUnmatchedPartialArgs(validArgs)
    ).toMatchObject({
      ok: true,
      args: {
        reviewId: '11111111-1111-4111-8111-111111111111',
        canonicalOrderId: '22222222-2222-4222-8222-222222222222',
        merchantId: '33333333-3333-4333-8333-333333333333',
      },
    });
  });

  it('rejects missing operator identity before any database operation', () => {
    const result = parseReconcilePaystackUnmatchedPartialArgs(
      validArgs.filter(
        (value) =>
          value !== '--operator-user-id' &&
          value !== '44444444-4444-4444-8444-444444444444'
      )
    );
    expect(result.ok).toBe(false);
  });

  it('parses the explicit email mismatch override', () => {
    const result = parseReconcilePaystackUnmatchedPartialArgs([
      ...validArgs,
      '--allow-email-mismatch',
      'true',
    ]);

    expect(result).toMatchObject({
      ok: true,
      args: { allowEmailMismatch: true },
    });
  });

  it('rejects unknown flags instead of silently stripping them', () => {
    const result = parseReconcilePaystackUnmatchedPartialArgs([
      ...validArgs,
      '--unexpected-flag',
      'value',
    ]);

    expect(result).toMatchObject({ ok: false });
  });

  it('rejects duplicate flags instead of allowing the last value to win', () => {
    const result = parseReconcilePaystackUnmatchedPartialArgs([
      ...validArgs,
      '--review-id',
      '99999999-9999-4999-8999-999999999999',
    ]);

    expect(result).toMatchObject({ ok: false });
  });
});
