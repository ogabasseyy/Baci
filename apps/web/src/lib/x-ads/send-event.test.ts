import { afterEach, expect, it, vi } from 'vitest';
import { sendXEvent } from './send-event';

const credentials = {
  consumerKey: 'example-key',
  consumerSecret: 'example-secret',
  accessToken: 'example-access',
  accessTokenSecret: 'example-token-secret',
};
const event = {
  event_id: 'paid',
  conversion_id: 'order-one',
  conversion_time: '2026-10-26T10:00:00Z',
  identifiers: [{ hashed_email: 'a'.repeat(64) }],
  value: '5',
  price_currency: 'NGN',
  number_items: 1,
};
afterEach(() => vi.unstubAllGlobals());
it('sends OAuth-signed JSON to the fixed X host and requires a processed conversion', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      data: { conversions_processed: 1, debug_id: 'receipt-one' },
    })
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await sendXEvent('abc', credentials, event)).toMatchObject({
    success: true,
    providerResponseId: 'receipt-one',
    httpStatus: 200,
  });
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe('https://ads-api.x.com/12/measurement/conversions/abc');
  expect(request.headers.Authorization).toMatch(/^OAuth /);
  expect(request.headers.Authorization).not.toContain('example-secret');
  expect(JSON.parse(request.body)).toEqual({ conversions: [event] });
});
it.each([
  {},
  { data: { conversions_processed: 0 } },
  { data: { conversions_processed: '1' } },
])('does not claim delivery from an empty/zero/invalid success receipt', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
  expect(await sendXEvent('abc', credentials, event)).toMatchObject({
    success: false,
    errorCode: 'invalid_provider_receipt',
    requestMayHaveBeenSent: true,
  });
});
it('does not expose a provider error body that may echo credentials', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ token: 'example-secret' }, { status: 401 })
      )
  );
  const result = await sendXEvent('abc', credentials, event);
  expect(result).toMatchObject({
    success: false,
    errorCode: 'provider_rejected',
    httpStatus: 401,
  });
  expect(JSON.stringify(result)).not.toContain('example-secret');
});
it('keeps lost responses indeterminate', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('provider possibly sent'))
  );
  expect(await sendXEvent('abc', credentials, event)).toMatchObject({
    success: false,
    errorCode: 'provider_transport_failed',
    requestMayHaveBeenSent: true,
  });
});
