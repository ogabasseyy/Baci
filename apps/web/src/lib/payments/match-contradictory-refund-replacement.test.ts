import { describe, expect, it } from 'vitest';
import {
  allFailedLegsCoveredByReplacements,
  type FailedRefundRow,
  type ReplacementRefundRow,
} from './match-contradictory-refund-replacement';

function failed(overrides: Partial<FailedRefundRow> = {}): FailedRefundRow {
  return {
    amount: 100,
    created_at: '2026-09-27T12:00:00Z',
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'RFD-1',
    id: 'refund-1',
    metadata: { payment_transaction_id: 'payment-1' },
    ...overrides,
  };
}

function replacement(
  overrides: Partial<ReplacementRefundRow> = {}
): ReplacementRefundRow {
  return {
    amount: 100,
    created_at: '2026-09-27T13:00:00Z',
    currency: 'NGN',
    gateway: 'paystack',
    id: 'refund-2',
    metadata: {
      payment_transaction_id: 'payment-1',
      provider_refund_status: 'processed',
    },
    status: 'completed',
    ...overrides,
  };
}

describe('allFailedLegsCoveredByReplacements', () => {
  it('covers a failed leg with a later verified replacement', () => {
    expect(
      allFailedLegsCoveredByReplacements([failed()], [replacement()])
    ).toBe(true);
  });

  it('returns true when no failed rows remain', () => {
    expect(allFailedLegsCoveredByReplacements([], [replacement()])).toBe(true);
  });

  it('matches effective gateways on both sides', () => {
    // A failed stamped manual claiming Paystack money meets its later
    // native provider replacement instead of filing a contradiction.
    const manualFailed = failed({
      gateway: 'manual',
      metadata: { method: 'paystack', payment_transaction_id: 'payment-1' },
    });
    expect(
      allFailedLegsCoveredByReplacements([manualFailed], [replacement()])
    ).toBe(true);
    // And the reverse direction: a failed native row meets a later
    // verified manual Paystack claim on the same leg.
    const manualReplacement = replacement({
      gateway: 'manual',
      metadata: {
        method: 'paystack',
        payment_transaction_id: 'payment-1',
        provider_refund_status: 'processed',
      },
    });
    expect(
      allFailedLegsCoveredByReplacements([failed()], [manualReplacement])
    ).toBe(true);
  });

  it('requires provider verification for Paystack replacements', () => {
    const unverified = replacement({
      metadata: {
        payment_transaction_id: 'payment-1',
        provider_refund_status: 'pending',
      },
    });
    expect(allFailedLegsCoveredByReplacements([failed()], [unverified])).toBe(
      false
    );
  });

  it('rejects replacements on other legs, gateways, or currencies', () => {
    const cases = [
      replacement({
        metadata: {
          payment_transaction_id: 'payment-9',
          provider_refund_status: 'processed',
        },
      }),
      replacement({ gateway: 'korapay' }),
      replacement({ currency: 'USD' }),
      replacement({ created_at: '2026-09-27T11:00:00Z' }),
    ];
    for (const candidate of cases) {
      expect(allFailedLegsCoveredByReplacements([failed()], [candidate])).toBe(
        false
      );
    }
  });

  it('spends each replacement once across split failures', () => {
    const first = failed({ id: 'refund-1' });
    const second = failed({
      created_at: '2026-09-27T12:30:00Z',
      id: 'refund-9',
    });
    // One 100-unit replacement cannot cover two 100-unit failures.
    expect(
      allFailedLegsCoveredByReplacements([first, second], [replacement()])
    ).toBe(false);
    // Two 50-unit replacements cover one 100-unit failure.
    const halves = [
      replacement({ amount: 50, id: 'refund-2' }),
      replacement({
        amount: 50,
        created_at: '2026-09-27T14:00:00Z',
        id: 'refund-3',
      }),
    ];
    expect(allFailedLegsCoveredByReplacements([first], halves)).toBe(true);
  });

  it('fails closed on malformed amounts', () => {
    expect(
      allFailedLegsCoveredByReplacements(
        [failed({ amount: 'not-a-number' })],
        [replacement()]
      )
    ).toBe(false);
    expect(
      allFailedLegsCoveredByReplacements(
        [failed()],
        [replacement({ amount: 'not-a-number' })]
      )
    ).toBe(false);
    expect(
      allFailedLegsCoveredByReplacements(
        [failed({ amount: 0 })],
        [replacement()]
      )
    ).toBe(false);
  });
});
