import { describe, expect, it } from 'vitest';
import { opsOpenRequestRowSchema } from './ops-open-request-row';

const row = {
  request_id: '3f0e0000-0000-4000-8000-000000000001',
  action: 'treasury_sweep',
  label: 'Move Collection wallet money to the Ogabassey bank account',
  subject:
    'piggyvest_primary.wallet_transfers:0a0e0000-0000-4000-8000-000000000001',
  amount_kobo: '1500000',
  amount_naira: '₦15,000.00',
  destination: 'Bank 058 ••••6789 "Ogabassey GTBank"',
  reason: null,
  requested_by: 'pv_ops_tunde',
  opened_at: new Date('2026-10-31T10:00:00Z'),
  expires_at: new Date('2026-11-01T10:00:00Z'),
  approvals: 1,
  decided_by_you: false,
  digest: 'a'.repeat(64),
};

describe('opsOpenRequestRowSchema', () => {
  it('parses a listing row and turns the bigint amount into a safe number', () => {
    const parsed = opsOpenRequestRowSchema.parse(row);
    expect(parsed.amountKobo).toBe(1_500_000);
    expect(parsed.requestId).toBe(row.request_id);
    expect(parsed.decidedByYou).toBe(false);
  });

  it.each([
    ['a negative amount', { amount_kobo: '-1' }],
    ['a fractional amount', { amount_kobo: '1.5' }],
    ['an unsafe amount', { amount_kobo: '9007199254740993' }],
    ['a short digest', { digest: 'abc' }],
    ['an unknown column', { approver: 'pv_approver_amaka' }],
  ])('rejects %s', (_label, change) => {
    expect(
      opsOpenRequestRowSchema.safeParse({ ...row, ...change }).success
    ).toBe(false);
  });
});
