import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type SecretUnionModule = typeof import('@/lib/piggyvest/webhook-secret-union');

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  intake: vi.fn(),
  processEvent: vi.fn(),
  quarantine: vi.fn(),
  families: ['interest'] as string[],
  secret: globalThis.crypto.randomUUID(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeServiceClient: mocks.createClient,
}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async (importOriginal) => {
  const actual = await importOriginal<SecretUnionModule>();
  return {
    ...actual,
    verifyPiggyvestWebhookSecrets: (input: {
      rawBody: Uint8Array;
      signature: string | null;
    }) => {
      const secret = actual.matchPiggyvestWebhookSecret({
        ...input,
        secrets: [mocks.secret],
      });
      return secret
        ? { status: 'verified' as const, secret, families: mocks.families }
        : { status: 'invalid' as const };
    },
  };
});
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-intake', () => ({
  dispatchPrimaryWalletPaidInterestInbox: mocks.intake,
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: mocks.processEvent,
}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'f'.repeat(64),
  recordQuarantineEvent: mocks.quarantine,
}));

import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

let store: ReturnType<typeof createFakeCaptureStore>;
const sign = (body: Uint8Array) =>
  createHmac('sha512', mocks.secret).update(body).digest('hex');

function post(body: Buffer, signature = sign(body)) {
  return POST(
    new NextRequest('https://synthetic.example.test/api/webhooks/piggyvest', {
      method: 'POST',
      body: Uint8Array.from(body),
      headers: { 'x-pvb-signature': signature },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  mocks.families = ['interest'];
  mocks.createClient.mockImplementation(() => store.client());
  mocks.quarantine.mockResolvedValue('recorded');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

// These deliveries used to go into the interest-only inbox before parsing.
// Generic ingress now owns their exact bytes; malformed content must never
// become a primary interest receipt or be resolved as financially processed.
it.each([
  ['empty object', Buffer.from('{}')],
  ['wrong event type', Buffer.from('{"eventType":"other","eventId":"e1"}')],
  ['missing event id', Buffer.from('{"eventType":"interest-payout.success"}')],
  ['not JSON', Buffer.from('not-json')],
  ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0x00])],
])('captures signed %s before content quarantine', async (_label, body) => {
  const signature = sign(body);
  mocks.quarantine.mockImplementation(async () => {
    // Prove capture already succeeded when parser rejection is recorded.
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      rawHex: body.toString('hex'),
      signature,
      processingState: 'pending',
    });
    return 'recorded';
  });

  const response = await post(body);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true, quarantined: true });
  expect(mocks.quarantine).toHaveBeenCalledTimes(1);
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.processEvent).not.toHaveBeenCalled();
  expect(store.resolveCalls).toEqual([]);
});

it('canonicalizes signature evidence while preserving the original request bytes and header', async () => {
  const body = Buffer.from(' \n{"unexpected":{"opaque":"雪"}}\t\n');
  const signature = sign(body);

  const response = await post(body, signature.toUpperCase());

  expect(response.status).toBe(200);
  expect(store.rows[0]).toMatchObject({
    rawHex: body.toString('hex'),
    signature,
    headers: { 'x-pvb-signature': signature.toUpperCase() },
    processingState: 'pending',
  });
});

it.each([
  'legacy',
  'bank',
  'custody',
])('captures unknown signed bytes under %s authority without an interest receipt', async (family) => {
  mocks.families = [family];
  const body = Buffer.from('{ malformed');

  const response = await post(body);

  expect(response.status).toBe(200);
  expect(store.rows[0]?.rawHex).toBe(body.toString('hex'));
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.processEvent).not.toHaveBeenCalled();
});

it('rejects forged signatures before constructing capture authority', async () => {
  const response = await post(Buffer.from('{}'), '0'.repeat(128));

  expect(response.status).toBe(401);
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(store.rows).toEqual([]);
  expect(mocks.quarantine).not.toHaveBeenCalled();
});

it('requests redelivery if generic durable capture fails, without acknowledging a digest-only quarantine', async () => {
  store.failCapture = true;

  const response = await post(Buffer.from('{ malformed'));

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: 'PIGGYVEST_CAPTURE_UNAVAILABLE',
  });
  expect(store.rows).toEqual([]);
  expect(mocks.quarantine).not.toHaveBeenCalled();
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.processEvent).not.toHaveBeenCalled();
});
