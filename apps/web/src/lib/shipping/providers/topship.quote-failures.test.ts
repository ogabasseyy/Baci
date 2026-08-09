import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteRequest } from '../types';

const request: QuoteRequest = {
  sessionId: 'quote-failure-session',
  shipmentType: 'domestic',
  receiver: {
    name: 'Receiver',
    phone: '08000000000',
    address: '1 Test Street',
    city: 'Abuja',
    state: 'FCT',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 50_000 }],
} as QuoteRequest;

describe('TopshipProvider quote failure signaling', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TOPSHIP_API_KEY = 'test-api-key';
    process.env.TOPSHIP_USE_SANDBOX = 'true';
    process.env.TOPSHIP_SANDBOX_URL = 'https://topship.test/api';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.TOPSHIP_API_KEY;
    delete process.env.TOPSHIP_USE_SANDBOX;
    delete process.env.TOPSHIP_SANDBOX_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'the provider returns a non-success response',
      fetchResult: () =>
        Promise.resolve(new Response('unavailable', { status: 503 })),
    },
    {
      name: 'the provider request rejects',
      fetchResult: () => Promise.reject(new Error('request timed out')),
    },
    {
      name: 'the provider returns malformed JSON',
      fetchResult: () =>
        Promise.resolve(
          new Response('{', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        ),
    },
  ])('marks an empty result when $name', async ({ fetchResult }) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(fetchResult));
    const [{ TopshipProvider }, { quoteProviderFailure }] = await Promise.all([
      import('./topship'),
      import('../quote-provider-failure'),
    ]);

    const result = await new TopshipProvider().getQuotes(request);

    expect(result).toEqual([]);
    expect(quoteProviderFailure.get(result)).toBeInstanceOf(Error);
  });

  it('does not mark a successful empty-rate response as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [{ TopshipProvider }, { quoteProviderFailure }] = await Promise.all([
      import('./topship'),
      import('../quote-provider-failure'),
    ]);

    const result = await new TopshipProvider().getQuotes(request);

    expect(result).toEqual([]);
    expect(quoteProviderFailure.get(result)).toBeUndefined();
  });
});
