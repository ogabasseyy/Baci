import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { primaryBankInboxFixture } from '@/lib/piggyvest/primary-wallet-bank-inbox.test-fixture';

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  quarantine: vi.fn(),
  process: vi.fn(),
}));

vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/piggyvest/webhook-secret-union', () => ({
  verifyPiggyvestWebhookSecrets: () => ({
    status: 'verified',
    secret: 'synthetic',
    families: ['legacy'],
  }),
}));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeServiceClient: () => ({}),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: mocks.record,
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: mocks.process,
}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'synthetic-digest',
  recordQuarantineEvent: mocks.quarantine,
}));
vi.mock('./primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: async () => null,
}));

import { POST } from './route';

it('requests redelivery when a conflicting known event cannot be quarantined', async () => {
  mocks.record.mockResolvedValue('conflict');
  mocks.quarantine.mockRejectedValue(new Error('private database detail'));
  const response = await POST(
    new NextRequest('https://synthetic.example.test/api/webhooks/piggyvest', {
      method: 'POST',
      body: JSON.stringify(primaryBankInboxFixture.event),
      headers: { 'x-pvb-signature': 'a'.repeat(128) },
    })
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: 'Event intake unavailable',
    code: 'PIGGYVEST_INBOX_ERROR',
  });
  expect(mocks.quarantine).toHaveBeenCalledOnce();
  expect(mocks.process).not.toHaveBeenCalled();
});
