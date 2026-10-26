import { afterEach, expect, it, vi } from 'vitest';
import { sendFacebookClientObservation } from './send-facebook-client-observation';

const input = {
  baseUrl: 'http://localhost:3000',
  event: 'ViewContent' as const,
  merchantId: 'merchant-a',
  userData: {},
  eventData: { currency: 'NGN', value: 200 },
};
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('requires the visitor decision before posting an observation', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await sendFacebookClientObservation(input)).toMatchObject({
    sent: false,
    error: 'consent_required',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('distinguishes queued ingress from delivered provider events', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ queued: true, sent: false }),
    })
  );
  expect(await sendFacebookClientObservation(input)).toMatchObject({
    success: true,
    sent: false,
    queued: true,
  });
});
it('does not classify a rejected request as accepted even if its body claims queued', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ queued: true }) })
  );
  expect(await sendFacebookClientObservation(input)).toMatchObject({
    success: false,
    sent: false,
    queued: false,
  });
});
