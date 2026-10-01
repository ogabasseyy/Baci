import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://storefront.example.com',
        merchantSlug: 'ogabassey',
      },
    },
  },
}));

import {
  fetchRepairDeviceDetail,
  fetchRepairDevices,
  RepairCatalogTimeoutError,
  RepairCatalogUnavailableError,
  submitRepairBooking,
} from './repair-catalog-client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('fetchRepairDevices', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
  });

  it('requests the merchant-scoped devices endpoint and returns grouped devices', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        groups: [{ brand: 'Apple', devices: [] }],
      })
    );

    const groups = await fetchRepairDevices();

    expect(groups).toEqual([{ brand: 'Apple', devices: [] }]);
    expect(fetch).toHaveBeenCalledWith(
      'https://storefront.example.com/api/storefront/ogabassey/repairs/devices',
      expect.objectContaining({})
    );
  });

  it('appends the search query when provided', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { groups: [] }));

    await fetchRepairDevices('iphone 13');

    expect(fetch).toHaveBeenCalledWith(
      'https://storefront.example.com/api/storefront/ogabassey/repairs/devices?q=iphone%2013',
      expect.objectContaining({})
    );
  });

  it('passes an already-aborted signal to an immediately cancelled request', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { groups: [] }));

    await fetchRepairDevices(undefined, AbortSignal.abort());

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.objectContaining({ aborted: true }),
      })
    );
  });

  it('throws RepairCatalogUnavailableError on a 404 (catalogue disabled)', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(404, { error: 'Repairs catalogue not available' })
      );

    await expect(fetchRepairDevices()).rejects.toBeInstanceOf(
      RepairCatalogUnavailableError
    );
  });

  it('throws a generic error on a 500', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    await expect(fetchRepairDevices()).rejects.toThrow('boom');
  });

  it('throws when the response body fails schema validation', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { groups: 'not-an-array' }));

    await expect(fetchRepairDevices()).rejects.toThrow(/invalid/i);
  });

  it('fails with a typed timeout when the devices request stalls', async () => {
    jest.useFakeTimers();
    jest.mocked(fetch).mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          );
        })
    );

    try {
      const request = fetchRepairDevices();
      const assertion = expect(request).rejects.toBeInstanceOf(
        RepairCatalogTimeoutError
      );
      await jest.advanceTimersByTimeAsync(5_000);

      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails with a typed timeout when the devices response body stalls', async () => {
    jest.useFakeTimers();
    jest.mocked(fetch).mockImplementationOnce((_input, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true }
            );
          }),
      } as unknown as Response)
    );

    try {
      const request = fetchRepairDevices();
      const assertion = expect(request).rejects.toBeInstanceOf(
        RepairCatalogTimeoutError
      );
      await jest.advanceTimersByTimeAsync(5_000);

      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('fetchRepairDeviceDetail', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
  });

  const detail = {
    device: {
      id: 'd1',
      brand: 'Apple',
      model: 'iPhone 13',
      slug: 'apple-iphone-13',
      deviceType: 'Smartphone',
      imageUrl: null,
      productId: null,
    },
    quotes: [],
    product: null,
  };

  it('requests the device-detail endpoint and returns the parsed detail', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, detail));

    const result = await fetchRepairDeviceDetail('apple-iphone-13');

    expect(result).toEqual(detail);
    expect(fetch).toHaveBeenCalledWith(
      'https://storefront.example.com/api/storefront/ogabassey/repairs/devices/apple-iphone-13',
      expect.objectContaining({})
    );
  });

  it('throws RepairCatalogUnavailableError when the device is not found', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(404, { error: 'Device not found' }));

    await expect(fetchRepairDeviceDetail('missing')).rejects.toBeInstanceOf(
      RepairCatalogUnavailableError
    );
  });
});

describe('submitRepairBooking', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
  });

  const validInput = {
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    customerPhone: '08012345678',
    deviceType: 'Smartphone' as const,
    deviceModel: 'iPhone 13',
    issueDescription: 'Cracked screen needs replacement.',
    serviceType: 'dropoff' as const,
  };

  it('POSTs the booking and returns the ticket on success', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 'repair-1', ticketNumber: 42 })
      );

    const result = await submitRepairBooking(validInput);

    expect(result).toEqual({ id: 'repair-1', ticketNumber: 42 });
    const [url, init] = jest.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://storefront.example.com/api/storefront/ogabassey/repairs/book'
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      customerEmail: 'ada@example.com',
    });
  });

  it('throws with field errors when the server returns a 400', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(400, {
        error: 'Validation failed',
        details: { fieldErrors: { customerEmail: ['Invalid email'] } },
      })
    );

    await expect(submitRepairBooking(validInput)).rejects.toMatchObject({
      message: 'Validation failed',
      fieldErrors: { customerEmail: ['Invalid email'] },
    });
  });

  it('throws a friendly error when the server returns a 429', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'Too many repair requests.' })
      );

    await expect(submitRepairBooking(validInput)).rejects.toThrow(
      'Too many repair requests.'
    );
  });
});
