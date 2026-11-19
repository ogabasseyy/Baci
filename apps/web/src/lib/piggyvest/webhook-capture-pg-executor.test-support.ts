import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { deterministicTestUuid } from './deterministic-test-data.test-support';
import type {
  CaptureDrainExecutor,
  CaptureDrainStatement,
} from './webhook-capture-pg-executor';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

/**
 * Doubles of the drain's pg executor. They answer the three fixed
 * statements with rows shaped exactly like the database's, so code under
 * test goes through the real pg queue (parsing included).
 *
 * - scriptedCaptureExecutor replays preset claim batches and records each
 *   resolve, for the drain suites that script what a claim returns.
 * - createStatefulCaptureExecutor models the capture table and the claim /
 *   resolve rules of 20261030231100_piggyvest_webhook_durable_capture_functions.sql
 *   (lease, grace period, expired-lease re-claim, token fencing, backoff),
 *   for crash and re-claim scenarios. Its 'resolve' statement is the
 *   worker's claim-bound entry point (a call without a token is refused);
 *   `completeInline` is the web receiver's tokenless completion, which the
 *   worker cannot reach.
 */

export interface ScriptedResolve {
  id: string;
  token: string | null;
  state: string;
  error: string | null;
}

export function scriptedCaptureExecutor(
  batches: PiggyvestClaimedCapture[][],
  onResolve: (call: ScriptedResolve) => boolean = () => true
): CaptureDrainExecutor & { statements: CaptureDrainStatement[] } {
  const queue = [...batches];
  const statements: CaptureDrainStatement[] = [];
  const answer = (
    statement: CaptureDrainStatement,
    parameters: readonly unknown[]
  ): unknown[] => {
    statements.push(statement);
    if (statement === 'claim') return queue.shift() ?? [];
    if (statement === 'resolve') {
      const [id, token, state, error] = parameters as [
        string,
        string | null,
        string,
        string | null,
      ];
      if (state === 'renew') return [{ resolved: true }];
      return [{ resolved: onResolve({ id, token, state, error }) }];
    }
    return [
      {
        status: {
          pending: 0,
          claimed: 0,
          needsReview: 0,
          claimRecoveryVersion: 1,
          oldestUnprocessedAt: null,
          lastCapturedAt: null,
          lastProcessedAt: null,
        },
      },
    ];
  };
  return {
    statements,
    // A throw inside `answer` becomes a rejection, as with the real executor.
    query: (statement, parameters) =>
      new Promise((done) => done(answer(statement, parameters))),
    verifySession: () => Promise.resolve({ ok: true }),
  };
}

export interface ModelCapture {
  id: string;
  raw_hex: string;
  signature: string;
  key_version: string;
  key_families: PiggyvestWebhookKeyFamily[];
  event_type: string | null;
  provider_transaction_id: string | null;
  received_at: number;
  processing_state: 'pending' | 'claimed' | 'processed' | 'needs_review';
  attempts: number;
  config_deferrals: number;
  next_attempt_at: number | null;
  last_error: string | null;
  claim_token: string | null;
  lease_until: number | null;
  processed_at: number | null;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);
const backoffMs = (base: number, exponent: number) =>
  Math.min(3600, base * 2 ** Math.min(exponent, 10)) * 1000;
const iso = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString();

export function createStatefulCaptureExecutor(clock: () => number) {
  const rows: ModelCapture[] = [];
  let claims = 0;

  function insert(
    capture: Pick<
      ModelCapture,
      'raw_hex' | 'signature' | 'key_families' | 'event_type'
    > &
      Partial<ModelCapture>
  ): ModelCapture {
    const stored: ModelCapture = {
      id: deterministicTestUuid(`model-capture:${rows.length + 1}`),
      key_version: 'k-0123456789abcdef',
      provider_transaction_id: null,
      received_at: clock(),
      processing_state: 'pending',
      attempts: 0,
      config_deferrals: 0,
      next_attempt_at: null,
      last_error: null,
      claim_token: null,
      lease_until: null,
      processed_at: null,
      ...capture,
    };
    rows.push(stored);
    return stored;
  }

  function claim(limit: number, lease: number, minAge: number) {
    const now = clock();
    const due = rows
      .filter(
        (row) =>
          (row.processing_state === 'pending' &&
            row.received_at <= now - Math.max(minAge, 0) * 1000 &&
            (row.next_attempt_at === null || row.next_attempt_at <= now)) ||
          (row.processing_state === 'claimed' && (row.lease_until ?? 0) < now)
      )
      .sort(
        (a, b) =>
          (a.next_attempt_at ?? a.received_at) -
            (b.next_attempt_at ?? b.received_at) ||
          a.received_at - b.received_at ||
          a.id.localeCompare(b.id)
      )
      .slice(0, clamp(limit, 1, 100));
    return due.map((row) => {
      row.processing_state = 'claimed';
      row.claim_token = deterministicTestUuid(`model-claim:${++claims}`);
      row.lease_until = now + clamp(lease, 30, 3600) * 1000;
      row.attempts += 1;
      return {
        capture_id: row.id,
        claim_token: row.claim_token,
        raw_hex: row.raw_hex,
        signature: row.signature,
        key_version: row.key_version,
        key_families: row.key_families,
        attempts: row.attempts,
        event_type: row.event_type,
        provider_transaction_id: row.provider_transaction_id,
      };
    });
  }

  function resolve(
    id: string,
    token: string | null,
    state: string,
    error: string | null
  ): boolean {
    if (!['pending', 'processed', 'needs_review', 'deferred'].includes(state))
      throw new Error('invalid webhook capture state');
    if (token === null && (state === 'needs_review' || state === 'deferred'))
      throw new Error('review and deferral states require a claim');
    const row = rows.find((candidate) => candidate.id === id);
    const fenced =
      row !== undefined &&
      ((token !== null &&
        row.processing_state === 'claimed' &&
        row.claim_token === token) ||
        (token === null &&
          (row.processing_state === 'pending' ||
            (state === 'processed' &&
              ['claimed', 'needs_review'].includes(row.processing_state)))));
    if (!row || !fenced) return false;
    const now = clock();
    const deferred = state === 'deferred';
    if (deferred)
      row.next_attempt_at = now + backoffMs(60, row.config_deferrals);
    else if (state === 'pending' && token !== null)
      row.next_attempt_at = now + backoffMs(30, row.attempts);
    row.processing_state = deferred
      ? 'pending'
      : (state as ModelCapture['processing_state']);
    row.last_error = error === null ? null : error.slice(0, 200);
    if (deferred) {
      row.attempts = Math.max(row.attempts - 1, 0);
      row.config_deferrals = Math.min(row.config_deferrals + 1, 1000);
    }
    if (state === 'processed') row.processed_at = now;
    row.claim_token = null;
    row.lease_until = null;
    return true;
  }

  function status() {
    const open = rows.filter((row) =>
      ['pending', 'claimed'].includes(row.processing_state)
    );
    const count = (state: ModelCapture['processing_state']) =>
      rows.filter((row) => row.processing_state === state).length;
    const processed = rows.flatMap((row) =>
      row.processed_at === null ? [] : [row.processed_at]
    );
    return {
      pending: count('pending'),
      claimed: count('claimed'),
      needsReview: count('needs_review'),
      claimRecoveryVersion: 1,
      oldestUnprocessedAt: iso(
        open.length ? Math.min(...open.map((row) => row.received_at)) : null
      ),
      lastCapturedAt: iso(
        rows.length ? Math.max(...rows.map((row) => row.received_at)) : null
      ),
      lastProcessedAt: iso(processed.length ? Math.max(...processed) : null),
    };
  }

  function answer(
    statement: CaptureDrainStatement,
    parameters: readonly unknown[]
  ): unknown[] {
    const values = [...parameters];
    if (statement === 'claim') {
      const [limit, lease, minAge] = values as [number, number, number];
      return claim(limit, lease, minAge);
    }
    if (statement === 'resolve') {
      const [id, token, state, error] = values as [
        string,
        string | null,
        string,
        string | null,
      ];
      if (token === null)
        throw new Error('a claimed capture and its claim token are required');
      if (state === 'renew') {
        const row = rows.find((candidate) => candidate.id === id);
        const valid =
          row?.processing_state === 'claimed' &&
          row.claim_token === token &&
          (row.lease_until ?? 0) > clock();
        if (valid && row) row.lease_until = clock() + 300_000;
        return [{ resolved: valid }];
      }
      return [{ resolved: resolve(id, token, state, error) }];
    }
    return [{ status: status() }];
  }

  const executor: CaptureDrainExecutor = {
    // A throw inside `answer` becomes a rejection, as with the real executor.
    query: (statement, parameters) =>
      new Promise((done) => done(answer(statement, parameters))),
    verifySession: () => Promise.resolve({ ok: true }),
  };
  /** Successful receiver completion wins over a concurrent worker claim. */
  const completeInline = (id: string) => resolve(id, null, 'processed', null);
  return { executor, rows, insert, completeInline };
}
