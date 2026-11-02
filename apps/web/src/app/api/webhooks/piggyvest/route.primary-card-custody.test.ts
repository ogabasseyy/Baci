import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-custody-inbox.test-fixture';

const mocks = vi.hoisted(() => ({
  intake: vi.fn(),
  legacy: vi.fn(),
  legacyFrom: vi.fn(),
  families: ['legacy', 'custody'] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: () => fixture.configuration.webhookSecret,
  getPiggyvestApiConfig: () => undefined,
}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async (importOriginal) => {
  const actual = await importOriginal<WebhookSecretUnionModule>();
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
  createPiggyvestIntakeServiceClient: () => withCaptureRpc(mocks.legacy()),
}));

import { POST } from './route';
import { withCaptureRpc } from './route.capture-test-support';

type WebhookSecretUnionModule =
  typeof import('@/lib/piggyvest/webhook-secret-union');

function request(valid = true) {
  return new NextRequest('https://example.test/api/webhooks/piggyvest', {
    method: 'POST',
    body: fixture.rawBody.toString(),
    headers: { 'x-pvb-signature': valid ? fixture.signature : '0'.repeat(128) },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  // These suites exercise the deployment where the capture drain is
  // scheduled, so a failed processing attempt answers the deferred 200.
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', 'true');
  mocks.families = ['legacy', 'custody'];
  mocks.legacyFrom.mockImplementation(() => {
    throw new Error('legacy must not handle primary custody');
  });
  mocks.legacy.mockImplementation(() => ({ from: mocks.legacyFrom }));
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
  expect(mocks.legacyFrom).not.toHaveBeenCalled();
});
it('keeps the captured row and answers 200 when signed custody storage is unavailable', async () => {
  mocks.intake.mockResolvedValue({
    outcome: 'storage_unavailable',
    response: Response.json(
      { code: 'PRIMARY_CARD_INBOX_UNAVAILABLE' },
      { status: 503 }
    ),
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    captured: true,
    processing: 'deferred',
  });
  expect(mocks.legacyFrom).not.toHaveBeenCalled();
});
it('does not dispatch forged custody receipts', async () => {
  expect((await POST(request(false))).status).toBe(401);
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.legacyFrom).not.toHaveBeenCalled();
});
it('preserves legacy processing when intake proves a receipt is unrelated', async () => {
  mocks.intake.mockResolvedValue({ outcome: 'not_handled', response: null });
  // Legacy storage is the stubbed-out failure here: the legacy path ran
  // (it reached storage), and the captured row is kept for retry.
  expect((await POST(request())).status).toBe(200);
  expect(mocks.legacyFrom).toHaveBeenCalled();
});
it('skips the custody intake for legacy-only deliveries so legacy outflow processing proceeds', async () => {
  mocks.families = ['legacy'];
  const response = await POST(request());
  expect(mocks.intake).not.toHaveBeenCalled();
  expect(mocks.legacyFrom).toHaveBeenCalled();
  expect(response.status).toBe(200);
});
it('redacts unexpected custody failures without falling through to legacy', async () => {
  mocks.intake.mockRejectedValue(new Error('private custody database detail'));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private custody'
  );
  expect(mocks.legacyFrom).not.toHaveBeenCalled();
});
