import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { describeDelivery } from './webhook-capture';
import {
  type DrainDeps,
  drainPiggyvestWebhookCaptures,
  MAX_DRAIN_ATTEMPTS,
} from './webhook-capture-drain';
import {
  drainDeps,
  HOUR,
  inflow,
  NOW,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';

const freshKey = deterministicKeySource('webhook-capture-drain');

let current: string;
let env: NodeJS.ProcessEnv;
let resolved: ResolvedCall[];
let alerts: ReturnType<typeof vi.spyOn>;

const deps = (
  claimed: PiggyvestClaimedCapture[][],
  process: DrainDeps['process']
) => drainDeps(() => ({ env, resolved }), claimed, process);

beforeEach(() => {
  current = freshKey();
  env = { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: current };
  resolved = [];
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
});

describe('drainPiggyvestWebhookCaptures', () => {
  it('processes a row left behind by a crash after capture and resolves it', async () => {
    const stored = row(inflow, sign(current, inflow));
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: Buffer.from(inflow),
        signature: sign(current, inflow),
        matchedSecret: current,
        families: ['legacy'],
        keyScope: 'replay',
      })
    );
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'processed', error: null },
    ]);
    expect(summary).toEqual({
      claimed: 1,
      processed: 1,
      retried: 0,
      needsReview: 0,
    });
  });

  it('replays a body signed by a revoked, replay-only key', async () => {
    const old = freshKey();
    env = {
      ...env,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify([
        {
          version: 'pv-2026-07',
          family: 'legacy',
          secret: old,
          retiredAt: new Date(NOW.getTime() - 400 * HOUR).toISOString(),
        },
      ]),
    };
    const stored = row(inflow, sign(old, inflow), {
      key_version: 'pv-2026-07',
    });
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(summary.processed).toBe(1);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ matchedSecret: old })
    );
  });

  it('never processes bytes it can no longer authenticate', async () => {
    const forgedLater = row(inflow, sign(freshKey(), inflow));
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[forgedLater]], process)
    );

    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      {
        id: forgedLater.capture_id,
        state: 'needs_review',
        error: 'REPLAY_SIGNATURE_UNVERIFIABLE',
      },
    ]);
    expect(summary.needsReview).toBe(1);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE')
    );
  });

  it.each([
    ['a failing result', async () => ({ status: 503 })],
    [
      'a thrown error',
      async () => {
        throw new Error('ledger unavailable');
      },
    ],
  ])('keeps the row for retry after %s', async (_name, failing) => {
    const stored = row(inflow, sign(current, inflow), { attempts: 3 });

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], failing)
    );

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'pending',
        error: 'PROCESSING_INCOMPLETE',
      },
    ]);
    expect(summary).toEqual({
      claimed: 1,
      processed: 0,
      retried: 1,
      needsReview: 0,
    });
  });

  it('escalates to review and alerts once the attempt budget is spent', async () => {
    const stored = row(inflow, sign(current, inflow), {
      attempts: MAX_DRAIN_ATTEMPTS,
    });

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], async () => ({ status: 503 }))
    );

    expect(resolved[0]).toMatchObject({
      state: 'needs_review',
      error: 'PROCESSING_ATTEMPTS_EXHAUSTED',
    });
    expect(summary.needsReview).toBe(1);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_NEEDS_REVIEW')
    );
  });

  it('is idempotent: replaying the same stored row twice applies the provider transaction once', async () => {
    const stored = row(inflow, sign(current, inflow));
    const ledger = new Set<string>();
    let credits = 0;
    // Stand-in for the downstream ledgers, which key on the provider
    // transaction id carried in the replayed bytes.
    const process = vi.fn(async (delivery: { rawBody: Buffer }) => {
      const key = describeDelivery(delivery.rawBody).providerTransactionId;
      if (key && !ledger.has(key)) {
        ledger.add(key);
        credits += 1;
      }
      return { status: 200 };
    });

    // First run: processed, but the process crashes before resolve lands, so
    // the lease expires and the very same row is claimed again.
    const crashing = deps([[stored]], process);
    crashing.resolve = async () => {
      throw new Error('worker crashed before resolve');
    };
    await drainPiggyvestWebhookCaptures(crashing);
    await drainPiggyvestWebhookCaptures(deps([[stored]], process));

    expect(process).toHaveBeenCalledTimes(2);
    expect(credits).toBe(1);
  });

  it('keeps going after one row fails and reports every outcome', async () => {
    const good = row(inflow, sign(current, inflow));
    const badBody = JSON.stringify({ eventId: 'evt-2', eventType: 'x' });
    const bad = row(badBody, sign(current, badBody));
    const process = vi.fn(async (delivery: { rawBody: Buffer }) =>
      delivery.rawBody.toString() === badBody
        ? { status: 503 }
        : { status: 200 }
    );

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[bad, good]], process)
    );

    expect(summary).toEqual({
      claimed: 2,
      processed: 1,
      retried: 1,
      needsReview: 0,
    });
  });
});
