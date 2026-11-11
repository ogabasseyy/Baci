import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeRequeue, main, OPERATOR_DATABASE_URL_ENV } from './cli';
import { OperatorRefusal, type OperatorStore } from './operator-store';

const CAPTURE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const env = {
  [OPERATOR_DATABASE_URL_ENV]:
    'postgres://ops@db.abcdefghijklmnopqrst.supabase.co/postgres',
};
const parked = {
  captureId: CAPTURE,
  eventType: 'bank-transfer.inflow.success',
  providerTransactionId: 'txn-1',
  keyVersion: 'k1',
  attempts: 20,
  lastError: 'REPLAY_FAILED',
  receivedAt: '2026-11-10T10:00:00Z',
  lastChangedAt: '2026-11-10T12:00:00Z',
  operatorReplays: 0,
};

let out: string[];
let err: string[];
let store: {
  list: ReturnType<typeof vi.fn>;
  requeue: ReturnType<typeof vi.fn>;
};

const run = (
  argv: string[],
  environment: Record<string, string | undefined> = env
) =>
  main(
    argv,
    environment,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    () => store as unknown as OperatorStore
  );

beforeEach(() => {
  out = [];
  err = [];
  store = { list: vi.fn(async () => [parked]), requeue: vi.fn() };
});

describe('capture replay CLI', () => {
  it('prints usage for help', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(out[0]).toContain('requeue <capture-id>');
  });

  it('exits 64 on a usage error without touching the database', async () => {
    expect(await run(['requeue', CAPTURE])).toBe(64);
    expect(store.requeue).not.toHaveBeenCalled();
  });

  it('refuses without an operator connection string', async () => {
    expect(await run(['list'], {})).toBe(77);
    expect(err[0]).toContain('Refused');
    expect(store.list).not.toHaveBeenCalled();
  });

  it('lists parked captures as metadata', async () => {
    expect(await run(['list'])).toBe(0);
    expect(out[0]).toContain(CAPTURE);
    expect(out[0]).toContain('error=REPLAY_FAILED');
  });

  it('only previews a requeue without --yes', async () => {
    expect(
      await run(['requeue', CAPTURE, '--reason', 'fix #4199 deployed'])
    ).toBe(0);
    expect(out[0]).toContain('Re-run with --yes');
    expect(store.requeue).not.toHaveBeenCalled();
  });

  it('does not suggest a blind --yes for an id the preview cannot show', async () => {
    const unseen = '11111111-2222-4333-8444-555555555555';
    expect(
      await run(['requeue', unseen, '--reason', 'fix #4199 deployed'])
    ).toBe(1);
    expect(out[0]).toContain('Check the id with `list`');
    expect(out[0]).not.toContain('--yes');
    expect(store.requeue).not.toHaveBeenCalled();
  });

  it('finds a parked capture beyond the first 200 for the preview', async () => {
    const older = {
      ...parked,
      captureId: '22222222-3333-4444-8555-666666666666',
    };
    const fullPage = Array.from({ length: 200 }, () => parked);
    store.list.mockImplementation(async (_limit: number, offset = 0) =>
      offset === 0 ? fullPage : [older]
    );
    expect(
      await run(['requeue', older.captureId, '--reason', 'fix #4199 deployed'])
    ).toBe(0);
    expect(out[0]).toContain(`Would requeue ${older.captureId}`);
    expect(store.list).toHaveBeenNthCalledWith(2, 200, 200);
    expect(store.requeue).not.toHaveBeenCalled();
  });

  it('requeues with --yes', async () => {
    store.requeue.mockResolvedValue({
      outcome: 'requeued',
      auditId: 9,
      previousAttempts: 20,
      previousLastError: 'REPLAY_FAILED',
      operatorReplays: 1,
      replayLimit: 7,
    });
    expect(
      await run(['requeue', CAPTURE, '--reason', 'fix #4199 deployed', '--yes'])
    ).toBe(0);
    expect(store.requeue).toHaveBeenCalledWith(CAPTURE, 'fix #4199 deployed');
    expect(out[0]).toContain('audit #9');
    // The cap shown comes from the database, never a copied literal.
    expect(out[0]).toContain('operator replay 1 of 7');
  });

  it('exits 1 when the database changed nothing', async () => {
    store.requeue.mockResolvedValue({
      outcome: 'not_in_review',
      processingState: 'processed',
    });
    expect(
      await run(['requeue', CAPTURE, '--reason', 'fix #4199 deployed', '--yes'])
    ).toBe(1);
    expect(out[0]).toContain('Nothing changed');
  });

  it('reports a refused session without detail leakage', async () => {
    store.list.mockRejectedValue(
      new OperatorRefusal('session refused: not encrypted')
    );
    expect(await run(['list'])).toBe(77);
    expect(err[0]).toBe(
      'Refused: session refused: not encrypted. Nothing was changed.'
    );
  });

  it('refuses a weakened connection string before any database call', async () => {
    const code = await main(
      ['list'],
      {
        [OPERATOR_DATABASE_URL_ENV]:
          'postgres://ops@db.abcdefghijklmnopqrst.supabase.co/x?sslmode=no-verify',
      },
      { out: (t) => out.push(t), err: (t) => err.push(t) }
    );
    expect(code).toBe(77);
    expect(err[0]).toContain('sslmode must be verify-full');
  });

  it('reports a database failure generically', async () => {
    store.list.mockRejectedValue(
      new Error('password authentication failed for user x')
    );
    expect(await run(['list'])).toBe(70);
    expect(err[0]).not.toContain('password');
  });

  it('describes every requeue outcome', () => {
    expect(
      describeRequeue({
        outcome: 'credit_dedupe_missing',
        eventType: 'bank-transfer.inflow.success',
      })
    ).toContain('could credit twice');
    expect(describeRequeue({ outcome: 'not_found' })).toContain('No capture');
    expect(
      describeRequeue({
        outcome: 'replay_limit_reached',
        operatorReplays: 3,
        replayLimit: 3,
      })
    ).toContain('the limit is 3');
  });
});
