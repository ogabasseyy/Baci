import { repairPickupClient } from './repair-pickup-client';
import { repairPickupPaymentAttempt } from './repair-pickup-payment-attempt';

jest.mock('./repair-pickup-payment-attempt', () => ({
  repairPickupPaymentAttempt: {
    get: jest.fn(async () => ({
      requestId: '14bf2192-16de-442b-bf75-700f4ff2aaca',
      expectedPickupFee: 3000,
    })),
    clear: jest.fn(),
  },
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: { apiUrl: 'https://example.com', merchantSlug: 'test' },
  },
}));
const data = {
  customerName: 'Test',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone' as const,
  deviceModel: 'iPhone',
  issueDescription: 'Broken screen',
  serviceType: 'pickup' as const,
  pickupAddress: '10 Test Road, Osogbo, Osun',
};
describe('repairPickupClient', () => {
  beforeEach(() => jest.clearAllMocks());
  it('returns resume_invalid even when durable attempt cleanup fails', async () => {
    const result = { success: false, code: 'resume_invalid', error: 'Expired' };
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => result });
    jest
      .mocked(repairPickupPaymentAttempt.clear)
      .mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(
      repairPickupClient.pay(data, 3000, 'expired')
    ).resolves.toEqual(result);
  });
  it('maps HTML or empty HTTP failures to a safe repair-service message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });
    await expect(repairPickupClient.quote(data)).rejects.toThrow(
      'Could not contact the repair service.'
    );
  });
  it('reuses the durable identity after a timed-out payment response', async () => {
    jest.useFakeTimers();
    const fetch = jest
      .fn()
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          )
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ticketNumber: 123,
          resumeToken: 'token',
          payment: {
            amount: 3000,
            reference: 'ref',
            authorizationUrl: 'https://checkout.paystack.com/test',
          },
        }),
      });
    global.fetch = fetch;
    try {
      const first = expect(repairPickupClient.pay(data, 3000)).rejects.toThrow(
        'timed out'
      );
      await jest.advanceTimersByTimeAsync(30_000);
      await first;
      await repairPickupClient.pay(data, 4000);
      expect(JSON.parse(fetch.mock.calls[1][1].body).expectedPickupFee).toBe(
        3000
      );
      expect(JSON.parse(fetch.mock.calls[0][1].body).requestId).toBe(
        JSON.parse(fetch.mock.calls[1][1].body).requestId
      );
      expect(repairPickupPaymentAttempt.clear).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('aborts stalled requests and reports a bounded timeout', async () => {
    jest.useFakeTimers();
    const original = global.fetch;
    global.fetch = jest.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('Aborted'))
          );
        })
    );
    try {
      const request = repairPickupClient.quote(data);
      const assertion = expect(request).rejects.toThrow('Request timed out');
      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
      jest.useRealTimers();
    }
  });
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('sends the quote to the configured merchant without merchant identity in the body', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ price: 3000, currency: 'NGN' }),
    });
    global.fetch = fetch;
    await expect(repairPickupClient.quote(data)).resolves.toEqual({
      price: 3000,
      currency: 'NGN',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api/storefront/test/repairs/pickup',
      expect.objectContaining({
        body: JSON.stringify({ action: 'quote', data }),
      })
    );
  });
  it('rejects invalid quote amounts', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ price: -1, currency: 'NGN' }),
    });
    await expect(repairPickupClient.quote(data)).rejects.toThrow();
  });
  it('surfaces provider unavailability without retrying', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Choose drop-off' }),
    });
    global.fetch = fetch;
    await expect(repairPickupClient.quote(data)).rejects.toThrow(
      'Choose drop-off'
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
