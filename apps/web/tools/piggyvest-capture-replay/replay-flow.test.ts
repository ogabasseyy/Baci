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
import { verifyStoredPiggyvestDelivery } from '@/lib/piggyvest/verify-stored-piggyvest-delivery';
import {
  type DrainDeps,
  drainPiggyvestWebhookCaptures,
} from '@/lib/piggyvest/webhook-capture-drain';
import {
  NOW,
  row,
  schemaValidInflow,
  sign,
} from '@/lib/piggyvest/webhook-capture-drain.test-support';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { main } from './cli';
import {
  createOperatorStore,
  OPERATOR_VERIFY_SESSION_SQL,
} from './operator-store';

/**
 * End to end over one in-memory capture table that follows the SQL contract
 * of 20261111140000_piggyvest_capture_operator_replay.sql (that SQL itself is
 * proven by supabase/tests/piggyvest_webhook_capture_operator_replay.sql):
 * operator CLI -> requeue -> the REAL drain (real stored-signature
 * verification) -> a ledger that dedupes on pvb_reference like the real ones.
 */

type State = 'pending' | 'claimed' | 'processed' | 'needs_review';
interface StoredCapture {
  claimed: PiggyvestClaimedCapture;
  state: State;
  attempts: number;
  lastError: string | null;
}

const freshKey = deterministicKeySource('capture-operator-replay');
const CONNECTION = 'postgres://ops.alice@db.example.test:5432/postgres';

let key: string;
let captures: Map<string, StoredCapture>;
let audit: { captureId: string; actor: string; reason: string }[];
let ledger: Map<string, number>;
let out: string[];
let err: string[];

function requeueInMemory(captureId: string, reason: string, actor: string) {
  const capture = captures.get(captureId);
  if (!capture) return { outcome: 'not_found' };
  if (capture.state !== 'needs_review')
    return { outcome: 'not_in_review', processingState: capture.state };
  const replays = audit.filter((entry) => entry.captureId === captureId).length;
  if (replays >= 5)
    return {
      outcome: 'replay_limit_reached',
      operatorReplays: replays,
      replayLimit: 5,
    };
  const previous = { attempts: capture.attempts, lastError: capture.lastError };
  capture.state = 'pending';
  capture.attempts = 0;
  capture.lastError = 'OPERATOR_REPLAY_REQUESTED';
  audit.push({ captureId, actor, reason });
  return {
    outcome: 'requeued',
    auditId: audit.length,
    previousAttempts: previous.attempts,
    previousLastError: previous.lastError,
    operatorReplays: replays + 1,
    replayLimit: 5,
  };
}

function operatorStore(session: Record<string, unknown>) {
  return createOperatorStore({
    connectionString: CONNECTION,
    createClient: () => ({
      connect: async () => undefined,
      end: async () => undefined,
      query: async (text, values = []) => {
        if (text === OPERATOR_VERIFY_SESSION_SQL) return { rows: [session] };
        if (text.includes('requeue_review_capture'))
          return {
            rows: [
              {
                result: requeueInMemory(
                  String(values[0]),
                  String(values[1]),
                  String(session.login_name)
                ),
              },
            ],
          };
        return { rows: [{ captures: [] }] };
      },
    }),
  });
}

const operatorSession = {
  login_name: 'ops_alice',
  login_safe: true,
  operator_member: true,
  pipeline_member: false,
  grants_usable: true,
  secure_transport: true,
};

function drainDeps(): DrainDeps {
  return {
    claim: async (limit) => {
      const due = [...captures.values()]
        .filter((capture) => capture.state === 'pending')
        .slice(0, limit);
      for (const capture of due) {
        capture.state = 'claimed';
        capture.attempts += 1;
      }
      return due.map((capture) => ({
        ...capture.claimed,
        attempts: capture.attempts,
      }));
    },
    renew: async (id) => captures.get(id)?.state === 'claimed',
    resolve: async (id, _token, state, error) => {
      const capture = captures.get(id);
      if (capture?.state !== 'claimed') return false;
      capture.state = state === 'deferred' ? 'pending' : state;
      capture.lastError = error;
      return true;
    },
    verify: (input) =>
      verifyStoredPiggyvestDelivery({
        ...input,
        env: { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: key },
        now: NOW,
      }),
    // Credits the main wallet once per pvb_reference, like the real ledgers.
    process: async (delivery) => {
      const event = JSON.parse(delivery.rawBody.toString('utf8')) as {
        pvb_reference: string;
        eventData: { amount: number };
      };
      if (!ledger.has(event.pvb_reference))
        ledger.set(event.pvb_reference, event.eventData.amount);
      return { status: 200 };
    },
  };
}

function park(body: string, signature: string): string {
  const claimed = row(body, signature);
  captures.set(claimed.capture_id, {
    claimed,
    state: 'needs_review',
    attempts: 20,
    lastError: 'REPLAY_FAILED',
  });
  return claimed.capture_id;
}

const cli = (
  argv: string[],
  env: Record<string, string | undefined>,
  session = operatorSession
) =>
  main(argv, env, { out: (t) => out.push(t), err: (t) => err.push(t) }, () =>
    operatorStore(session)
  );

const env = { PIGGYVEST_CAPTURE_OPERATOR_DATABASE_URL: CONNECTION };
const reason = ['--reason', 'interest attribution fix deployed', '--yes'];

beforeEach(() => {
  key = freshKey();
  captures = new Map();
  audit = [];
  ledger = new Map();
  out = [];
  err = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('operator replay of a parked PiggyVest capture', () => {
  it('replays a parked capture exactly once after an authenticated operator requeue', async () => {
    const body = schemaValidInflow('evt-parked-1');
    const id = park(body, sign(key, body));

    expect(await drainPiggyvestWebhookCaptures(drainDeps())).toMatchObject({
      claimed: 0,
    });
    expect(await cli(['requeue', id, ...reason], env)).toBe(0);
    const summary = await drainPiggyvestWebhookCaptures(drainDeps());

    expect(summary).toEqual({
      claimed: 1,
      processed: 1,
      retried: 0,
      needsReview: 0,
    });
    expect(captures.get(id)?.state).toBe('processed');
    expect([...ledger.entries()]).toEqual([['fixture-pvb-reference', 10000]]);
    expect(audit).toEqual([
      {
        captureId: id,
        actor: 'ops_alice',
        reason: 'interest attribution fix deployed',
      },
    ]);
  });

  it('refuses an unauthenticated call and changes nothing', async () => {
    const body = schemaValidInflow('evt-parked-2');
    const id = park(body, sign(key, body));

    expect(await cli(['requeue', id, ...reason], {})).toBe(77);
    expect(
      await cli(['requeue', id, ...reason], env, {
        ...operatorSession,
        operator_member: false,
      })
    ).toBe(77);
    expect(
      await cli(['requeue', id, ...reason], env, {
        ...operatorSession,
        login_name: 'service_role',
      })
    ).toBe(77);

    expect(captures.get(id)?.state).toBe('needs_review');
    expect(audit).toEqual([]);
    expect(err.every((line) => line.startsWith('Refused:'))).toBe(true);
  });

  it('is a no-op for an event the ledger already credited', async () => {
    const body = schemaValidInflow('evt-parked-3');
    const id = park(body, sign(key, body));
    ledger.set('fixture-pvb-reference', 10000);

    await cli(['requeue', id, ...reason], env);
    await drainPiggyvestWebhookCaptures(drainDeps());
    expect(await cli(['requeue', id, ...reason], env)).toBe(1);
    await drainPiggyvestWebhookCaptures(drainDeps());

    expect(captures.get(id)?.state).toBe('processed');
    expect([...ledger.entries()]).toEqual([['fixture-pvb-reference', 10000]]);
    expect(audit).toHaveLength(1);
    expect(out.at(-1)).toContain('is processed, not parked for review');
  });

  it('never processes requeued bytes that no key vouches for', async () => {
    const body = schemaValidInflow('evt-parked-4');
    const id = park(body, sign(freshKey(), body));

    await cli(['requeue', id, ...reason], env);
    const summary = await drainPiggyvestWebhookCaptures(drainDeps());

    expect(summary.processed).toBe(0);
    expect(captures.get(id)?.state).toBe('needs_review');
    expect(ledger.size).toBe(0);
  });
});
