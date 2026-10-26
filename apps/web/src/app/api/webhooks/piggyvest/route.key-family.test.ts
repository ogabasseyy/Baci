import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  interestInbox: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  families: ['interest'] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/webhook-secret-union', () => ({
  verifyPiggyvestWebhookSecrets: () => ({
    status: 'verified',
    secret: 'interest-secret',
    families: mocks.families,
  }),
}));
vi.mock('@/env', () => ({
  getPiggyvestApiConfig: () => null,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mocks.createServiceClient(),
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-intake', () => ({
  dispatchPrimaryWalletPaidInterestInbox: mocks.interestInbox,
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));

import { POST } from './route';

const restrictionEvent = {
  eventId: '6b9d2f4a-3c1e-4a5b-9d8f-2e4b6a8c0d12',
  eventType: 'restriction-created.success',
  eventCategory: 'restriction',
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  eventData: {},
  pvb_wallet: 'pvb-wallet-synthetic-001',
};

function chainable(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  const upsert = vi.fn(() => query);
  const select = vi.fn(() =>
    Object.assign(Promise.resolve(result), {
      eq: vi.fn(() => ({
        maybeSingle: async () => ({ data: null, error: null }),
      })),
    })
  );
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  Object.assign(query, { select, then, upsert });
  return { query, upsert };
}

function createRequest(rawBody: string): NextRequest {
  return new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'x-pvb-signature': '0'.repeat(128),
    },
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.families = ['interest'];
  mocks.interestInbox.mockResolvedValue('quarantined');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
});

it('durably quarantines a known non-interest event signed only by the interest family', async () => {
  const rawBody = JSON.stringify(restrictionEvent);
  const signature = '0'.repeat(128);
  const response = await POST(createRequest(rawBody));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    quarantined: true,
  });
  expect(mocks.interestInbox).toHaveBeenCalledWith({
    rawBody: Buffer.from(rawBody),
    signature,
  });
  expect(mocks.createServiceClient).not.toHaveBeenCalled();
  expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
});

it('legacy-processes the same event when the legacy family matches', async () => {
  mocks.families = ['legacy'];
  const { query, upsert } = chainable({
    data: [{ event_id: restrictionEvent.eventId }],
    error: null,
  });
  mocks.createServiceClient.mockReturnValue({
    from: vi.fn(() => query),
  });

  const response = await POST(createRequest(JSON.stringify(restrictionEvent)));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    duplicate: false,
  });
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      event_id: restrictionEvent.eventId,
      event_type: 'restriction-created.success',
    }),
    { onConflict: 'event_id', ignoreDuplicates: true }
  );
  expect(mocks.processPiggyvestEvent).toHaveBeenCalled();
});
