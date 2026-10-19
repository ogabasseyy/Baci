import { describe, expect, it } from 'vitest';
import { matchPaystackDvaCandidates } from '@/lib/payments/paystack-dva-multi-key-match';
import { candidate, ctx } from './paystack-dva-multi-key-match.test-support';

describe('matchPaystackDvaCandidates — paid_at window', () => {
  it('rejects paid_at before account_created_at (defensive lower bound)', () => {
    const result = matchPaystackDvaCandidates(
      [candidate()],
      ctx({ paidAt: new Date('2026-05-09T09:59:00Z') })
    );
    expect(result.kind).toBe('none');
  });

  it('accepts one uniquely matching late invoice payment after the +90min window', () => {
    const result = matchPaystackDvaCandidates(
      [candidate()],
      ctx({ paidAt: new Date('2026-05-09T12:53:00Z') })
    );
    expect(result.kind).toBe('single');
    if (result.kind === 'single') {
      expect(result.timing).toBe('late');
    }
  });

  it('does not auto-allocate a late underpayment to a stale merchant invoice', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: true,
          outstanding_amount_kobo: 83_500_000,
        }),
      ],
      ctx({
        paidAt: new Date('2026-05-09T12:53:00Z'),
        verifiedAmountKobo: 30_000_000,
      })
    );

    expect(result.kind).toBe('none');
  });

  it('matches a partial invoice transfer throughout its explicit reservation term', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          merchant_created: true,
          outstanding_amount_kobo: 83_500_000,
          account_expires_at: new Date('2026-05-23T10:00:00Z'),
        }),
      ],
      ctx({
        verifiedAmountKobo: 30_000_000,
        paidAt: new Date('2026-05-15T12:53:00Z'),
      })
    );

    expect(result).toMatchObject({
      allocation: 'partial',
      kind: 'single',
      timing: 'in_window',
    });
  });

  it('uses the unique late-match fallback when account_expires_at is beyond the grace window', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ account_expires_at: new Date('2026-05-09T13:00:00Z') })],
      ctx({ paidAt: new Date('2026-05-09T11:35:00Z') })
    );
    expect(result.kind).toBe('single');
  });

  it('falls back to +90min when account_expires_at is null', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ account_expires_at: null })],
      ctx({ paidAt: new Date('2026-05-09T11:25:00Z') })
    );
    expect(result.kind).toBe('single');
  });

  it('uses account_assigned_at as the retry window anchor when present', () => {
    const result = matchPaystackDvaCandidates(
      [
        candidate({
          account_created_at: new Date('2026-05-09T08:00:00Z'),
          account_assigned_at: new Date('2026-05-09T10:00:00Z'),
          account_expires_at: new Date('2026-05-09T11:30:00Z'),
        }),
      ],
      ctx({ paidAt: new Date('2026-05-09T10:30:00Z') })
    );

    expect(result.kind).toBe('single');
  });

  it('rejects paid_at before account_assigned_at when present', () => {
    const result = matchPaystackDvaCandidates(
      [candidate({ account_assigned_at: new Date('2026-05-09T10:30:00Z') })],
      ctx({ paidAt: new Date('2026-05-09T10:29:00Z') })
    );

    expect(result.kind).toBe('none');
  });
});
