import { createHmac } from 'node:crypto';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { deterministicTestUuid } from './deterministic-test-data.test-support';
import { verifyStoredPiggyvestDelivery } from './verify-stored-piggyvest-delivery';
import { describeDelivery } from './webhook-capture';
import type { DrainDeps } from './webhook-capture-drain';

/**
 * Shared fixtures for the capture drain suites. The suites keep their own
 * `vi.mock` calls (they are hoisted per test file) and their own mutable
 * state; this module only holds the builders they share.
 */

export const NOW = new Date('2026-10-30T12:00:00.000Z');
export const HOUR = 3_600_000;
export const sign = (secret: string, body: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

function describeEvent(body: string) {
  const description = describeDelivery(new TextEncoder().encode(body));
  return {
    event_type: description.eventType,
    provider_transaction_id: description.providerTransactionId,
  };
}

let rowSequence = 0;

export function row(
  body: string,
  signature: string,
  overrides: Partial<PiggyvestClaimedCapture> = {}
): PiggyvestClaimedCapture {
  return {
    capture_id: deterministicTestUuid(`drain-row:${++rowSequence}:capture`),
    claim_token: deterministicTestUuid(`drain-row:${rowSequence}:claim`),
    raw_hex: Buffer.from(body).toString('hex'),
    signature,
    key_version: 'k-0123456789abcdef',
    key_families: ['legacy'],
    attempts: 1,
    ...describeEvent(body),
    ...overrides,
  };
}

export const inflow = JSON.stringify({
  eventId: 'evt-inflow-1',
  eventType: 'bank-transfer.inflow.success',
  eventData: { transaction_id: 'txn-77', amount: 1000 },
});

export interface ResolvedCall {
  id: string;
  state: string;
  error: string | null;
}

/**
 * Drain dependencies over an in-memory queue. `state` is read lazily, at
 * resolve and verify time, so a test may replace its `env` after building
 * the deps exactly as it could with module-level variables.
 */
export function drainDeps(
  state: () => { env: NodeJS.ProcessEnv; resolved: ResolvedCall[] },
  claimed: PiggyvestClaimedCapture[][],
  process: DrainDeps['process']
): DrainDeps {
  const queue = [...claimed];
  return {
    claim: () => Promise.resolve(queue.shift() ?? []),
    resolve: (id, _token, status, error) => {
      state().resolved.push({ id, state: status, error });
      return Promise.resolve(true);
    },
    verify: (input) =>
      verifyStoredPiggyvestDelivery({ ...input, env: state().env, now: NOW }),
    process,
  };
}
