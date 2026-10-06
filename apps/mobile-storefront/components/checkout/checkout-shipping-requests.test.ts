import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import {
  fetchCheckoutShippingCities,
  fetchCheckoutShippingStates,
} from './checkout-shipping-requests';

describe('checkout-shipping-requests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps FCT city results when API and form state labels use different aliases', async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({
        locations: [
          { city: 'Garki', state: 'Abuja' },
          { city: 'Ikeja', state: 'Lagos' },
        ],
      }),
      ok: true,
    })) as unknown as typeof fetch;

    await expect(
      fetchCheckoutShippingCities(
        'https://example.com',
        'FCT - Abuja',
        new AbortController().signal
      )
    ).resolves.toEqual(['Garki']);
  });

  it('returns an empty list for aborted or failed city requests', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
    })) as unknown as typeof fetch;

    await expect(
      fetchCheckoutShippingCities(
        'https://example.com',
        'Lagos',
        new AbortController().signal
      )
    ).resolves.toEqual([]);
  });

  it('reuses warmed checkout state requests for the next checkout mount', async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({ states: ['Lagos', 'FCT - Abuja'] }),
      ok: true,
    })) as unknown as typeof fetch;

    const first = fetchCheckoutShippingStates(
      'https://checkout-warmup.example'
    );
    const second = fetchCheckoutShippingStates(
      'https://checkout-warmup.example'
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      ['Lagos', 'FCT - Abuja'],
      ['Lagos', 'FCT - Abuja'],
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await expect(
      fetchCheckoutShippingStates('https://checkout-warmup.example')
    ).resolves.toEqual(['Lagos', 'FCT - Abuja']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses warmed location payloads for city lookups when the payload contains locations', async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({
        locations: [
          { city: 'Ikeja', state: 'Lagos' },
          { city: 'Lekki', state: 'Lagos' },
          { city: 'Garki', state: 'FCT - Abuja' },
        ],
        states: ['Lagos', 'FCT - Abuja'],
      }),
      ok: true,
    })) as unknown as typeof fetch;

    await expect(
      fetchCheckoutShippingStates('https://checkout-warm-locations.example')
    ).resolves.toEqual(['Lagos', 'FCT - Abuja']);
    await expect(
      fetchCheckoutShippingCities(
        'https://checkout-warm-locations.example',
        'Lagos',
        new AbortController().signal
      )
    ).resolves.toEqual(['Ikeja', 'Lekki']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps active city subscribers alive when another subscriber aborts', async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    ) as unknown as typeof fetch;
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = fetchCheckoutShippingCities(
      'https://checkout-shared-city-abort.example',
      'Lagos',
      firstController.signal
    );
    const second = fetchCheckoutShippingCities(
      'https://checkout-shared-city-abort.example',
      'Lagos',
      secondController.signal
    );
    firstController.abort();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://checkout-shared-city-abort.example/api/shipping/locations?state=Lagos',
      undefined
    );
    resolveResponse?.({
      json: async () => ({
        locations: [{ city: 'Ikeja', state: 'Lagos' }],
      }),
      ok: true,
    } as Response);

    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual(['Ikeja']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache malformed warmed checkout state responses', async () => {
    const mockFetch = jest
      .fn<FetchImplementation>()
      .mockResolvedValueOnce({
        json: async () => ({ states: null }),
        ok: true,
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ states: ['Lagos', 'FCT - Abuja'] }),
        ok: true,
      } as Response);
    global.fetch = mockFetch;

    await expect(
      fetchCheckoutShippingStates('https://checkout-malformed.example')
    ).resolves.toEqual([]);
    await expect(
      fetchCheckoutShippingStates('https://checkout-malformed.example')
    ).resolves.toEqual(['Lagos', 'FCT - Abuja']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
