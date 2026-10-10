import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { paidInterestFixture } from '@/lib/piggyvest/primary-wallet-paid-interest.test-support';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  intake: vi.fn(),
  legacy: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  families: ['legacy', 'interest'] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: () => 'fixture-secret',
  getPiggyvestApiConfig: () => undefined,
}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/piggyvest/webhook-secret-union')
    >();
  return {
    ...actual,
    verifyPiggyvestWebhookSecrets: (input: {
      rawBody: Uint8Array;
      signature: string | null;
    }) => {
      const secret = actual.matchPiggyvestWebhookSecret({
        ...input,
        secrets: ['fixture-secret', 'retained-secret'],
      });
      return secret
        ? { status: 'verified' as const, secret, families: mocks.families }
        : { status: 'invalid' as const };
    },
  };
});
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-dispatch', () => ({
  dispatchPrimaryWalletPaidInterest: mocks.dispatch,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-intake', () => ({
  dispatchPrimaryWalletPaidInterestInbox: mocks.intake,
}));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeServiceClient: mocks.legacy,
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));

import { POST } from './route';

const rawBody = JSON.stringify(paidInterestFixture.event);
function request(valid = true, secret = 'fixture-secret') {
  const signature = createHmac('sha512', secret).update(rawBody).digest('hex');
  return new NextRequest('https://example.test/api/webhooks/piggyvest', {
    method: 'POST',
    body: rawBody,
    headers: { 'x-pvb-signature': valid ? signature : '0'.repeat(128) },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.families = ['legacy', 'interest'];
  mocks.intake.mockResolvedValue('disabled');
  mocks.legacy.mockImplementation(() => {
    throw new Error('legacy must not handle primary interest');
  });
});
it.each([
  'accepted',
  'duplicate',
  'quarantined',
])('acknowledges stored interest %s without claiming financial credit', async (outcome) => {
  mocks.intake.mockResolvedValue(outcome);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    outcome === 'quarantined'
      ? { received: true, quarantined: true }
      : {
          received: true,
          interestQueued: true,
          duplicate: outcome === 'duplicate',
        }
  );
  expect(mocks.intake).toHaveBeenCalledWith({
    rawBody: Buffer.from(rawBody),
    signature: expect.any(String),
  });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('requests redelivery when storing signed interest fails', async () => {
  mocks.intake.mockRejectedValue(new Error('private receipt storage detail'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private receipt'
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it.each([
  'credited',
  'duplicate',
])('acknowledges verified primary interest %s without legacy processing', async (outcome) => {
  mocks.dispatch.mockResolvedValue(outcome);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    duplicate: outcome === 'duplicate',
  });
  expect(mocks.dispatch).toHaveBeenCalledWith({
    rawBody: Buffer.from(rawBody),
    signature: expect.any(String),
  });
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it.each([
  'prerequisite',
  'conflict',
])('does not drop or legacy-credit unresolved primary interest %s', async (outcome) => {
  mocks.dispatch.mockResolvedValue(outcome);
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('does not dispatch forged interest', async () => {
  expect((await POST(request(false))).status).toBe(200);
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('accepts a delivery signed with a retained rotation key', async () => {
  mocks.intake.mockResolvedValue('accepted');
  const response = await POST(request(true, 'retained-secret'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    interestQueued: true,
    duplicate: false,
  });
  expect(mocks.intake).toHaveBeenCalledTimes(1);
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('redacts primary interest storage failures and requests redelivery', async () => {
  mocks.dispatch.mockRejectedValue(new Error('private database detail'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private database'
  );
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('skips the interest intake for a legacy-family delivery', async () => {
  mocks.families = ['legacy'];
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  const query: Record<string, unknown> = {};
  const upsert = vi.fn(() => query);
  const select = vi.fn(() =>
    Object.assign(
      Promise.resolve({
        data: [{ event_id: paidInterestFixture.event.eventId }],
        error: null,
      }),
      {
        eq: vi.fn(() => ({
          maybeSingle: async () => ({ data: null, error: null }),
        })),
      }
    )
  );
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve({
      data: [{ event_id: paidInterestFixture.event.eventId }],
      error: null,
    }).then(resolve);
  Object.assign(query, { select, then, upsert });
  mocks.legacy.mockImplementation(() => ({ from: vi.fn(() => query) }));

  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    duplicate: false,
  });
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.processPiggyvestEvent).toHaveBeenCalled();
});
