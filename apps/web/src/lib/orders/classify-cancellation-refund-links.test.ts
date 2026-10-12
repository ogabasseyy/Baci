import { describe, expect, it } from 'vitest';
import {
  claimedRefundPaymentId,
  classifyCancellationRefundLinks,
} from './classify-cancellation-refund-links';

describe('classifyCancellationRefundLinks', () => {
  const legs = [{ id: 'payment-1' }, { id: 'payment-2' }];

  it('returns null for missing, null, and non-string claims', () => {
    expect(claimedRefundPaymentId({ metadata: null })).toBe(null);
    expect(claimedRefundPaymentId({ metadata: {} })).toBe(null);
    expect(
      claimedRefundPaymentId({ metadata: { payment_transaction_id: 42 } })
    ).toBe(null);
    expect(
      claimedRefundPaymentId({ metadata: { payment_transaction_id: 'p-1' } })
    ).toBe('p-1');
  });

  it('splits linked, unlinked, and invalid-link rows', () => {
    const linked = { metadata: { payment_transaction_id: 'payment-1' } };
    const unlinked = { metadata: {} };
    const invalid = { metadata: { payment_transaction_id: 'ghost' } };

    const result = classifyCancellationRefundLinks(
      [linked, unlinked, invalid],
      legs
    );

    expect(result.linkedPaymentId(linked)).toBe('payment-1');
    expect(result.linkedPaymentId(unlinked)).toBe(null);
    expect(result.linkedPaymentId(invalid)).toBe(null);
    expect(result.unlinkedRefunds).toEqual([unlinked]);
    expect(result.invalidLinkRefunds).toEqual([invalid]);
    expect(result.invalidLinkClaimedIds).toEqual(['ghost']);
  });

  it('builds the invalid-link reason only when invalid rows exist', () => {
    const invalid = { metadata: { payment_transaction_id: 'ghost' } };

    expect(
      classifyCancellationRefundLinks([invalid], legs).invalidLinkReason
    ).toContain('outside this order (ghost)');
    expect(
      classifyCancellationRefundLinks([{ metadata: {} }], legs)
        .invalidLinkReason
    ).toBe(null);
  });

  it('dedupes claimed ids across invalid rows', () => {
    const rows = [
      { metadata: { payment_transaction_id: 'ghost' } },
      { metadata: { payment_transaction_id: 'ghost' } },
    ];

    const result = classifyCancellationRefundLinks(rows, legs);

    expect(result.invalidLinkClaimedIds).toEqual(['ghost']);
  });
});
