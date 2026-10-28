import { afterEach, expect, it, vi } from 'vitest';
import { sendSocialClientObservation } from './send-social-client-observation';

const input = {
  baseUrl: 'https://shop.example',
  merchantId: '11111111-1111-4111-8111-111111111111',
  event: 'view_item' as const,
  eventId: 'one',
  eventData: {
    currency: 'NGN',
    value: 0,
    products: [{ id: 'one', name: 'Phone', price: 0, quantity: 1 }],
  },
};
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('sends only consented public observation data and treats a queued response as acceptance', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ queued: true, sent: false }),
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await sendSocialClientObservation('tiktok', input)).toMatchObject({
    success: true,
    sent: false,
    queued: true,
  });
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toMatchObject({
    consent: true,
    eventId: 'one',
    merchantId: input.merchantId,
  });
  expect(body.userData).toBeUndefined();
});
it('returns a safe failure for malformed queue receipts', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('secret');
      },
    })
  );
  expect(await sendSocialClientObservation('snapchat', input)).toMatchObject({
    success: false,
    sent: false,
    error: 'event_queue_unavailable',
  });
});
