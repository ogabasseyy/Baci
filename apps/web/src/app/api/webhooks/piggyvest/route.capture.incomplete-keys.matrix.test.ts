import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  recordPiggyvestEvent: vi.fn(),
  quarantine: vi.fn(),
  inflow: vi.fn(),
  bankIntake: vi.fn(),
  processVerified: vi.fn(),
  realProcessVerified: undefined as unknown as (
    ...args: unknown[]
  ) => Promise<Response>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mocks.createServiceClient(),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) =>
    mocks.recordPiggyvestEvent(...args),
}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'f'.repeat(64),
  recordQuarantineEvent: (...args: unknown[]) => mocks.quarantine(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: (...args: unknown[]) => mocks.inflow(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-intake', () => ({
  dispatchPrimaryWalletBankInboxIntake: (...args: unknown[]) =>
    mocks.bankIntake(...args),
}));
// Real processing by default; a case can make it throw out of the route.
vi.mock('./process-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process-delivery')>();
  mocks.realProcessVerified = actual.processVerifiedDelivery as never;
  return { ...actual, processVerifiedDelivery: mocks.processVerified };
});

import { primaryCardCustodyInboxFixture } from '@/lib/piggyvest/primary-wallet-card-custody-inbox.test-fixture';
import { testKey } from '@/lib/piggyvest/webhook-secret-union.test-support';
import { POST } from './route';
import {
  COMPLETE_ARCHIVE_WITHOUT_BANK,
  inflow,
  UNREADABLE_ARCHIVE,
} from './route.capture.incomplete-keys.test-support';
import { createFakeCaptureStore } from './route.capture-test-support';

/**
 * The ingress rule in one table. Every outcome of a delivery is listed once
 * for a COMPLETE and an INCOMPLETE key set, drain attested and not:
 * - a content outcome (success, unparseable, unknown shape, unhandled type)
 *   does not depend on the key set and never changes;
 * - every non-success outcome while the key set is incomplete (processing
 *   failure or throw, an event no loaded family can authorize, a primary
 *   event whose owning intake did not run) is provider-retryable (503), even
 *   with the drain attested, because the capture is limited to the families
 *   that loaded and replay can never widen it;
 * - with a complete key set the existing behaviour stands.
 */

const legacyKey = testKey('matrix-legacy');
const interestKey = testKey('matrix-interest');
const body = (value: object) => JSON.stringify(value);
const accrual = body({
  eventId: 'evt-accrued-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});

type Result = {
  status: number;
  code?: string;
  keys?: Record<string, unknown>;
  state: 'pending' | 'processed';
};
const RETRY = {
  status: 503,
  code: 'PIGGYVEST_PROCESSING_RETRY',
  state: 'pending',
} satisfies Result;
const NOT_READY = {
  status: 503,
  code: 'PIGGYVEST_NOT_READY',
  state: 'pending',
} satisfies Result;
const DEFERRED = {
  status: 200,
  keys: { processing: 'deferred' },
  state: 'pending',
} satisfies Result;
// Acknowledged, but the capture stays unresolved: a wrong-family event is
// recovered by a correctly signed redelivery, a rejected body by a resend
// after the parser fix. Neither may be swallowed as a processed duplicate.
const QUARANTINED = {
  status: 200,
  keys: { quarantined: true },
  state: 'pending',
} satisfies Result;

interface Case {
  name: string;
  payload: string;
  key: string;
  arrange?: () => void;
  expected: (incomplete: boolean, attested: boolean) => Result;
}

const CASES: Case[] = [
  {
    name: 'success',
    payload: accrual,
    key: legacyKey,
    expected: () => ({ status: 200, state: 'processed' }),
  },
  {
    name: 'ordinary processing failure',
    payload: accrual,
    key: legacyKey,
    arrange: () =>
      mocks.processPiggyvestEvent.mockRejectedValue(new Error('ledger down')),
    expected: (incomplete, attested) =>
      incomplete || !attested ? RETRY : DEFERRED,
  },
  {
    name: 'processing that throws out of the delivery handler',
    payload: accrual,
    key: legacyKey,
    arrange: () => mocks.processVerified.mockRejectedValue(new Error('boom')),
    expected: (incomplete, attested) =>
      incomplete || !attested ? RETRY : DEFERRED,
  },
  {
    name: 'custody event only the legacy fallback could complete',
    payload: primaryCardCustodyInboxFixture.rawBody.toString(),
    key: legacyKey,
    expected: (incomplete) =>
      incomplete ? NOT_READY : { status: 200, state: 'processed' },
  },
  {
    name: 'bank event signed by a family that cannot authorize it',
    payload: inflow,
    key: interestKey,
    expected: (incomplete) => (incomplete ? NOT_READY : QUARANTINED),
  },
  {
    name: 'interest accrual signed by the interest family (record-only)',
    payload: accrual,
    key: interestKey,
    expected: () => ({ status: 200, state: 'processed' }),
  },
  {
    name: 'unparseable body',
    payload: '<<not json>>',
    key: legacyKey,
    expected: () => QUARANTINED,
  },
  {
    name: 'unknown event shape',
    payload: body({ foo: 'bar' }),
    key: legacyKey,
    expected: () => QUARANTINED,
  },
  {
    name: 'unhandled event type (durable backlog)',
    payload: accrual,
    key: legacyKey,
    arrange: () => mocks.processPiggyvestEvent.mockResolvedValue('deferred'),
    expected: () => ({
      status: 200,
      keys: { deferred: true },
      state: 'processed',
    }),
  },
];

let store: ReturnType<typeof createFakeCaptureStore>;

function post(payload: string, key: string) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', key)
          .update(payload)
          .digest('hex'),
      },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  vi.stubEnv('PIGGYVEST_SECRET_KEY', legacyKey);
  vi.stubEnv('PVB_SECRET_KEY', '');
  // The interest family only reads its key in production.
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET', interestKey);
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  mocks.processVerified.mockReset();
  mocks.processVerified.mockImplementation(mocks.realProcessVerified);
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  mocks.quarantine.mockResolvedValue('recorded');
  mocks.inflow.mockResolvedValue('ignored');
  mocks.bankIntake.mockResolvedValue({ outcome: 'declined', response: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ['complete', false, COMPLETE_ARCHIVE_WITHOUT_BANK],
  ['incomplete', true, UNREADABLE_ARCHIVE],
] as const)('%s key set', (_label, incomplete, archive) => {
  describe.each([
    ['drain attested', true],
    ['drain not attested', false],
  ] as const)('%s', (_attestation, attested) => {
    it.each(CASES)('$name', async (testCase) => {
      vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', archive);
      vi.stubEnv(
        'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED',
        attested ? 'true' : 'false'
      );
      testCase.arrange?.();
      const expected = testCase.expected(incomplete, attested);

      const response = await post(testCase.payload, testCase.key);
      const json = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(expected.status);
      if (expected.code) expect(json.code).toBe(expected.code);
      if (expected.keys) expect(json).toMatchObject(expected.keys);
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]?.processingState).toBe(expected.state);
    });
  });
});
