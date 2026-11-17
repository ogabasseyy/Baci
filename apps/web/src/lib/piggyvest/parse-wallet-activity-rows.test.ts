import { describe, expect, it } from 'vitest';
import { parseWalletActivityRows } from './parse-wallet-activity-rows';

const row = (id: string, kind = 'wallet_spend') => ({
  id,
  kind,
  direction: 'out',
  amount_kobo: 50000,
  fee_kobo: 0,
  label: 'IMEI check',
  status: 'completed',
  occurred_at: '2026-11-14T10:00:00Z',
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('bugfix: one row the server could not show failed the whole page (Muse)', () => {
  it('leaves out a row of an unknown kind and keeps the rest', () => {
    const parsed = parseWalletActivityRows([row(A), row(B, 'cashback_credit')]);
    expect(parsed.rows.map((r) => r.id)).toEqual([A]);
  });

  it('pages past a left-out last row, so nothing is skipped or repeated', () => {
    const parsed = parseWalletActivityRows([row(A), row(B, 'cashback_credit')]);
    expect(parsed.count).toBe(2);
    expect(parsed.last).toEqual({ id: B, occurred_at: '2026-11-14T10:00:00Z' });
  });
});

describe('parseWalletActivityRows', () => {
  it('reads an empty page', () => {
    expect(parseWalletActivityRows(null)).toEqual({
      rows: [],
      last: undefined,
      count: 0,
    });
  });

  it('throws for a reply that is not a list, or a last row without its paging key', () => {
    expect(() => parseWalletActivityRows({ rows: [] })).toThrow();
    expect(() => parseWalletActivityRows([{ kind: 'x' }])).toThrow();
  });
});
