import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-custody-inbox.test-fixture';

const mocks = vi.hoisted(() => ({
  intake: vi.fn(),
  legacy: vi.fn(),
  families: ['legacy', 'custody'] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: () => fixture.configuration.webhookSecret,
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
        secrets: [fixture.configuration.webhookSecret],
      });
      // Family binding defaults to a secret shared across families;
      // individual tests narrow it to pin each intake gate.
      return secret
        ? { status: 'verified' as const, secret, families: mocks.families }
        : { status: 'invalid' as const };
    },
  };
});
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch', () => ({
  dispatchPrimaryCardSignedCustodyIntake: mocks.intake,
}));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeServiceClient: mocks.legacy,
}));

import { POST } from './route';

function request(valid = true) {
  return new NextRequest('https://example.test/api/webhooks/piggyvest', {
    method: 'POST',
    body: fixture.rawBody.toString(),
    headers: { 'x-pvb-signature': valid ? fixture.signature : '0'.repeat(128) },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.families = ['legacy', 'custody'];
  mocks.legacy.mockImplementation(() => {
    throw new Error('legacy must not handle primary custody');
  });
});
it.each([
  'accepted',
  'duplicate',
  'conflict',
])('returns durable custody %s without legacy processing', async (outcome) => {
  const body =
    outcome === 'conflict'
      ? { received: true, quarantined: true }
      : {
          received: true,
          custodyQueued: true,
          duplicate: outcome === 'duplicate',
        };
  mocks.intake.mockResolvedValue({ outcome, response: Response.json(body) });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(body);
  expect(mocks.intake).toHaveBeenCalledWith({
    rawBody: fixture.rawBody,
    signature: fixture.signature,
  });
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('requests redelivery when signed custody storage is unavailable', async () => {
  mocks.intake.mockResolvedValue({
    outcome: 'storage_unavailable',
    response: Response.json(
      { code: 'PRIMARY_CARD_INBOX_UNAVAILABLE' },
      { status: 503 }
    ),
  });
  expect((await POST(request())).status).toBe(503);
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('does not dispatch forged custody receipts', async () => {
  expect((await POST(request(false))).status).toBe(200);
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it('preserves legacy processing when intake proves a receipt is unrelated', async () => {
  mocks.intake.mockResolvedValue({ outcome: 'not_handled', response: null });
  expect((await POST(request())).status).toBe(503);
  expect(mocks.legacy).toHaveBeenCalledTimes(1);
});
it('skips the custody intake for legacy-only deliveries so legacy outflow processing proceeds', async () => {
  mocks.families = ['legacy'];
  const response = await POST(request());
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.legacy).toHaveBeenCalled();
  expect(response.status).toBe(503);
});
it('redacts unexpected custody failures without falling through to legacy', async () => {
  mocks.intake.mockRejectedValue(new Error('private custody database detail'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private custody'
  );
  expect(mocks.legacy).not.toHaveBeenCalled();
});
