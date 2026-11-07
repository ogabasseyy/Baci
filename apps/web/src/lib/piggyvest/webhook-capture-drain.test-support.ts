import { createHmac } from 'node:crypto';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { deterministicTestUuid } from './deterministic-test-data.test-support';
import { verifyStoredPiggyvestDelivery } from './verify-stored-piggyvest-delivery';
import { describeDelivery } from './webhook-capture';
import type { DrainDeps } from './webhook-capture-drain';
import { scriptedCaptureExecutor } from './webhook-capture-pg-executor.test-support';
import { createPgCaptureQueue } from './webhook-capture-queue';

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

/** A bank inflow the receiver's event schema accepts; only the ids vary. */
export const schemaValidInflow = (
  eventId: string,
  eventType = 'bank-transfer.inflow.success',
  transactionId = `txn-${eventId}`
) =>
  JSON.stringify({
    eventId,
    eventType,
    eventCategory: 'inflow_transaction',
    customer_id: 'fixture-customer',
    pvb_reference: 'fixture-pvb-reference',
    pvb_wallet: 'fixture-wallet',
    eventData: {
      id: `data-${eventId}`,
      customer_id: 'fixture-customer',
      destination_wallet_id: 'fixture-conduit',
      type: 'inter',
      category: 'bank_transfer_inflow',
      amount: 10000,
      currency: 'NGN',
      narration: '',
      ip_address: '',
      transaction_id: transactionId,
      timestamp: '2026-10-07T10:00:00.000Z',
      status: 'COMPLETED',
      third_party_reference: '',
      initiator_reference: '',
      internal_reference: '',
      provider: 'fixture-bank',
      destination_wallet_balance: 10000,
      destination_wallet_ledger_balance: 10000,
      destination_transaction_balance: 10000,
      reference: `reference-${eventId}`,
      recipient_bank_account_number: '0123456789',
      sender_name: 'Fixture sender',
      fee: 0,
    },
  });

export interface ResolvedCall {
  id: string;
  state: string;
  error: string | null;
}

/**
 * Drain dependencies whose claim and resolve go through the worker host's
 * pg queue over a scripted executor double, so every drain suite also runs
 * the statement mapping and the row parsing the dedicated drain login
 * uses. `state` is read lazily, at resolve and verify time, so a test may
 * replace its `env` after building the deps exactly as it could with
 * module-level variables.
 */
export function drainDeps(
  state: () => { env: NodeJS.ProcessEnv; resolved: ResolvedCall[] },
  claimed: PiggyvestClaimedCapture[][],
  process: DrainDeps['process']
): DrainDeps {
  const queue = createPgCaptureQueue(
    scriptedCaptureExecutor(claimed, (call) => {
      state().resolved.push({
        id: call.id,
        state: call.state,
        error: call.error,
      });
      return true;
    })
  );
  return {
    claim: (limit) => queue.claim(limit),
    renew: (id, token) => queue.renew(id, token),
    resolve: (id, token, status, error) =>
      queue.resolve(id, token, status, error),
    verify: (input) =>
      verifyStoredPiggyvestDelivery({ ...input, env: state().env, now: NOW }),
    process,
  };
}
