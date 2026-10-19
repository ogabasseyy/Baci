import { describe, expect, it } from 'vitest';
import { matchPaystackDvaCandidates } from '@/lib/payments/paystack-dva-multi-key-match';
import { candidate, ctx } from './paystack-dva-multi-key-match.test-support';

// B0 tightens DVA reconciliation to require ALL of:
// - amount = verified Paystack amount (kobo precision; ₦0.01 tolerance)
// - customer_email matches the Paystack customer
// - paid_at IN [created_at, expires_at when present, otherwise created_at + 90min]
// Plus the upstream lookup already filters by:
// - merchant_id (inferred via the order's merchant)
// - account_number + provider (the lookup key)
// - transactions.status pending (caller responsibility)

describe('matchPaystackDvaCandidates — happy paths', () => {
  it('matches exactly one candidate when all 6 keys line up', () => {
    const result = matchPaystackDvaCandidates([candidate()], ctx());
    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.timing).toBe('in_window');
      expect(result.candidate.order_id).toBe(
        '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae'
      );
    }
  });

  it('uses payable_amount_kobo when wallet or savings credits reduce the DVA charge', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          total_kobo: 83_500_000,
          payable_amount_kobo: 35_000_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 35_000_000 })
    );

    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.timing).toBe('in_window');
    }
  });

  it('matches the right candidate when two share an account number but only one fits the window', () => {
    // Stale DVA assignment from a month ago — paid_at falls way after
    // its +90min upper bound, so it's filtered out. Fresh assignment
    // matches.
    const stale = candidate({
      order_id: 'older-order',
      account_created_at: new Date('2026-04-01T00:00:00Z'),
      account_expires_at: new Date('2026-04-01T01:30:00Z'),
    });
    const fresh = candidate({ order_id: 'fresh-order' });

    const result = matchPaystackDvaCandidates([stale, fresh], ctx());
    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.timing).toBe('in_window');
      expect(result.candidate.order_id).toBe('fresh-order');
    }
  });

  it('matches a unique underpayment only for a merchant-created invoice', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: true,
          outstanding_amount_kobo: 83_500_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 30_000_000 })
    );

    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.allocation).toBe('partial');
      expect(result.candidate.order_id).toBe(
        '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae'
      );
    }
  });

  it('uses the remaining balance for the final transfer after a partial payment', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: true,
          outstanding_amount_kobo: 53_500_000,
          payable_amount_kobo: 83_500_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 53_500_000 })
    );

    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.allocation).toBe('exact');
    }
  });
});

describe('matchPaystackDvaCandidates — amount mismatch (kobo precision)', () => {
  it('drops candidates whose order_total differs by more than 1 kobo', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ total_kobo: 83_500_002 })],
      ctx()
    );
    expect(result.kind).toBe('none');
  });

  it('accepts ±1 kobo rounding', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ total_kobo: 83_499_999 })],
      ctx()
    );
    expect(result.kind).toBe('single');
  });

  it('falls back to total_kobo when no residual payable amount was persisted', () => {
    const result = matchPaystackDvaCandidates([candidate()], ctx());

    expect(result.kind).toBe('single');
  });

  it('does not treat a storefront-created order underpayment as an invoice partial payment', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: false,
          outstanding_amount_kobo: 83_500_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 30_000_000 })
    );

    expect(result.kind).toBe('none');
  });

  it('does not auto-allocate an overpayment to a merchant-created invoice', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: true,
          outstanding_amount_kobo: 53_500_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 60_000_000 })
    );

    expect(result.kind).toBe('none');
  });
});

describe('matchPaystackDvaCandidates — customer_email', () => {
  it('drops candidates whose customer_email differs case-insensitively', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ customer_email: 'someone-else@example.com' })],
      ctx()
    );
    expect(result.kind).toBe('none');
  });

  it('matches with case-insensitive customer_email + trimmed whitespace', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ customer_email: '  Customer@EXAMPLE.COM  ' })],
      ctx()
    );
    expect(result.kind).toBe('single');
  });
});

describe('matchPaystackDvaCandidates — ambiguity + zero candidates', () => {
  it('prefers an exact late match over an in-window merchant invoice partial', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          account_created_at: new Date('2026-05-09T08:00:00Z'),
          account_expires_at: new Date('2026-05-09T09:30:00Z'),
          order_id: 'older-exact-order',
          outstanding_amount_kobo: 30_000_000,
        }),
        candidate({
          merchant_created: true,
          order_id: 'fresh-partial-invoice',
          outstanding_amount_kobo: 83_500_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 30_000_000 })
    );

    expect(result).toMatchObject({
      allocation: 'exact',
      candidate: { order_id: 'older-exact-order' },
      kind: 'single',
      timing: 'late',
    });
  });

  it('returns ambiguous when 2+ candidates all match', () => {
    const a = candidate({ order_id: 'order-a' });
    const b = candidate({ order_id: 'order-b' });
    const result = matchPaystackDvaCandidates([a, b], ctx());
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.timing).toBe('in_window');
      expect(result.candidates.map((c) => c.order_id).sort()).toEqual([
        'order-a',
        'order-b',
      ]);
    }
  });

  it('returns ambiguous instead of guessing between merchant invoice partials', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: true,
          order_id: 'partial-a',
          outstanding_amount_kobo: 83_500_000,
        }),
        candidate({
          merchant_created: true,
          order_id: 'partial-b',
          outstanding_amount_kobo: 90_000_000,
        }),
      ],
      ctx({ verifiedAmountKobo: 30_000_000 })
    );

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.allocation).toBe('partial');
    }
  });

  it('returns ambiguous instead of guessing when 2+ late candidates match', () => {
    const lateContext = ctx({ paidAt: new Date('2026-05-09T12:53:00Z') });
    const result = matchPaystackDvaCandidates(
      [candidate({ order_id: 'late-a' }), candidate({ order_id: 'late-b' })],
      lateContext
    );

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.timing).toBe('late');
    }
  });

  it('deduplicates repeated snapshots for one order before late ambiguity', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          account_assigned_at: new Date('2026-05-09T10:00:00Z'),
          account_created_at: new Date('2026-05-09T10:00:00Z'),
        }),
        candidate({
          account_assigned_at: new Date('2026-05-09T10:30:00Z'),
          account_created_at: new Date('2026-05-09T10:30:00Z'),
        }),
      ],
      ctx({ paidAt: new Date('2026-05-09T12:53:00Z') })
    );

    expect(result).toMatchObject({
      candidate: {
        account_assigned_at: new Date('2026-05-09T10:30:00Z'),
      },
      kind: 'single',
      timing: 'late',
    });
  });

  it('returns none when zero candidates pass the filter', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ customer_email: 'mismatch@example.com' })],
      ctx()
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when the input list is empty', () => {
    const result = matchPaystackDvaCandidates([], ctx());
    expect(result.kind).toBe('none');
  });
});
