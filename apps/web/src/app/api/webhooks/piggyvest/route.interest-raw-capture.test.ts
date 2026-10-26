import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

type SecretUnionModule = typeof import('@/lib/piggyvest/webhook-secret-union');

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  processEvent: vi.fn(),
  families: ['interest'] as string[],
  secret: globalThis.crypto.randomUUID(),
}));

vi.mock('@/env', () => ({
  getPiggyvestApiConfig: () => null,
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
  dispatchPrimaryWalletPaidInterestInbox: mocks.capture,
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: mocks.processEvent,
}));

import { POST } from './route';

const secret = mocks.secret;
const rawBody =
  '{ "eventType":"interest-payout.success", "eventData":null, "x":"opaque" }';

function signedRequest(body: string, valid = true) {
  const signature = createHmac('sha512', secret).update(body).digest('hex');
  return new NextRequest(
    'https://synthetic.example.test/api/webhooks/piggyvest',
    {
      method: 'POST',
      body,
      headers: {
        'x-pvb-signature': valid ? signature : '0'.repeat(128),
      },
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.families = ['interest'];
  mocks.capture.mockResolvedValue('accepted');
  mocks.processEvent.mockResolvedValue('processed');
});

it('captures signed interest bytes before event schema parsing', async () => {
  const response = await POST(signedRequest(rawBody));

  expect(response.status).toBe(200);
  expect(mocks.capture).toHaveBeenCalledWith({
    rawBody: Buffer.from(rawBody),
    signature: expect.any(String),
  });
  expect(mocks.processEvent).not.toHaveBeenCalled();
  const responseText = JSON.stringify(await response.json());
  expect(responseText).not.toContain(secret);
  expect(responseText).not.toContain(rawBody);
});

it.each([
  '{"eventType":"interest-payout.success","eventData":{"amount":2,"currency":"USD"}}',
  '{ malformed signed interest payload',
])('captures exact signed unsupported interest bytes', async (body) => {
  const response = await POST(signedRequest(body));

  expect(response.status).toBe(200);
  expect(mocks.capture).toHaveBeenCalledWith({
    rawBody: Buffer.from(body),
    signature: createHmac('sha512', secret).update(body).digest('hex'),
  });
});

it('does not attempt raw capture for an invalid signature', async () => {
  await POST(signedRequest(rawBody, false));

  expect(mocks.capture).not.toHaveBeenCalled();
});

it('fails closed when a legacy-only key signs an explicit interest payout', async () => {
  mocks.families = ['legacy'];
  const body = JSON.stringify({
    eventType: 'interest-payout.success',
    eventId: 'synthetic-interest-event',
    eventCategory: 'interest-payout',
    eventData: {},
  });

  const response = await POST(signedRequest(body));

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
  });
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.processEvent).not.toHaveBeenCalled();
});

it('keeps shared-family bank events out of the interest capture path', async () => {
  mocks.families = ['interest', 'bank'];
  const bankBody = JSON.stringify({
    eventType: 'bank-transfer.inflow.success',
  });
  await POST(signedRequest(bankBody));

  expect(mocks.capture).not.toHaveBeenCalled();
});

it('captures ambiguous signed bytes when interest shares legacy authority', async () => {
  mocks.families = ['interest', 'legacy'];
  const body = '{"unexpected":{"nested":"shape"}}';
  const response = await POST(signedRequest(body));

  expect(response.status).toBe(200);
  expect(mocks.capture).toHaveBeenCalledWith({
    rawBody: Buffer.from(body),
    signature: createHmac('sha512', secret).update(body).digest('hex'),
  });
  expect(mocks.processEvent).not.toHaveBeenCalled();
});

it('returns retryable failure when early durable capture fails', async () => {
  mocks.capture.mockRejectedValue(new Error('synthetic storage detail'));
  const response = await POST(signedRequest(rawBody));
  const responseText = JSON.stringify(await response.json());

  expect(response.status).toBe(503);
  expect(responseText).not.toContain('synthetic storage detail');
  expect(responseText).not.toContain(rawBody);
  expect(responseText).not.toContain(secret);
  expect(mocks.processEvent).not.toHaveBeenCalled();
});
