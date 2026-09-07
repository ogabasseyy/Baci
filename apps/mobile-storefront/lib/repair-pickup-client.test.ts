import { repairPickupClient } from './repair-pickup-client';

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
