import {
  markHeldImeiCharges,
  STATUS_READ_TIMEOUT_MS,
} from './wallet-held-imei-charges';
import type { Transaction } from './wallet-query';

const tx = (id: string): Transaction => ({
  id,
  type: 'redemption',
  amount: -500,
  description: 'IMEI check',
  created_at: '2026-11-15T10:00:00.000Z',
  source_type: 'imei_wallet_payment',
});

function client(result: unknown) {
  const read = jest.fn(async (_ids: string[]) => result as never);
  return read;
}

const raw = [
  {
    id: 'tx-held',
    source_type: 'imei_wallet_payment',
    source_id: 'lookup-held',
  },
  {
    id: 'tx-done',
    source_type: 'imei_wallet_payment',
    source_id: 'lookup-done',
  },
  { id: 'tx-topup', source_type: 'wallet_topup', source_id: 'x' },
];

describe('bugfix: a held IMEI charge read as a finished purchase (walk M3)', () => {
  it('marks only charges whose check is still running', async () => {
    const db = client({
      data: [
        { id: 'lookup-held', status: 'submission_unknown' },
        { id: 'lookup-done', status: 'completed' },
      ],
      error: null,
    });
    const out = await markHeldImeiCharges(db, raw, [
      tx('tx-held'),
      tx('tx-done'),
      { ...tx('tx-topup'), source_type: 'wallet_topup' },
    ]);
    expect(out.map((row) => row.pending === true)).toEqual([
      true,
      false,
      false,
    ]);
    expect(db).toHaveBeenCalledWith(['lookup-held', 'lookup-done']);
  });

  it('asks nothing when there are no IMEI charges', async () => {
    const db = client({ data: [], error: null });
    const rows = [tx('tx-topup')];
    await expect(markHeldImeiCharges(db, [raw[2]], rows)).resolves.toBe(rows);
    expect(db).not.toHaveBeenCalled();
  });

  it('shows rows as before when the checks can not be read', async () => {
    const rows = [tx('tx-held')];
    for (const result of [
      { data: null, error: { message: 'denied' } },
      undefined,
    ]) {
      await expect(
        markHeldImeiCharges(client(result), raw, rows)
      ).resolves.toBe(rows);
    }
    const throwing = client(null);
    throwing.mockRejectedValueOnce(new Error('offline'));
    await expect(markHeldImeiCharges(throwing, raw, rows)).resolves.toBe(rows);
  });
});

describe('bugfix: a charge being refunded read as a check still running (Muse)', () => {
  it('marks a refund_pending charge as refunding, not pending', async () => {
    const db = client({
      data: [{ id: 'lookup-held', status: 'refund_pending' }],
      error: null,
    });
    const [row] = await markHeldImeiCharges(db, raw, [tx('tx-held')]);
    expect(row?.refunding).toBe(true);
    expect(row?.pending).toBeUndefined();
  });
});

describe('bugfix: a stalled status read could fail the whole wallet load (CodeRabbit)', () => {
  it('shows the rows unmarked once the read takes too long', async () => {
    jest.useFakeTimers();
    try {
      const rows = [tx('tx-held')];
      const stalled = jest.fn(() => new Promise<never>(() => undefined));
      const marked = markHeldImeiCharges(stalled, raw, rows);
      jest.advanceTimersByTime(STATUS_READ_TIMEOUT_MS);
      await expect(marked).resolves.toBe(rows);
    } finally {
      jest.useRealTimers();
    }
  });
});
