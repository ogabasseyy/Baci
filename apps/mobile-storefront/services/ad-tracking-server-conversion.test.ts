import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
const mockGetIsTrackingAllowed = jest.fn(() => false);
const mockFetch =
  jest.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >();

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://api.test' } } },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: mockDebug,
    error: jest.fn(),
    info: jest.fn(),
    warn: mockWarn,
  }),
}));

jest.mock('./ad-tracking-state', () => ({
  AD_API_URL: 'https://api.test',
  adTrackingLog: {
    debug: mockDebug,
    error: jest.fn(),
    info: jest.fn(),
    warn: mockWarn,
  },
  getCachedMerchantId: () => 'merchant-1',
  getCachedUserData: () => ({ email: 'shopper@example.com' }),
  getIsTrackingAllowed: () => mockGetIsTrackingAllowed(),
}));

jest.mock('./ad-tracking-runtime', () => ({
  AD_TRACKING_PLATFORM: 'ios',
}));

describe('sendServerConversion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIsTrackingAllowed.mockReturnValue(false);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => '',
    } as Response);
    global.fetch = mockFetch;
  });

  it.each([
    false,
    undefined,
    null,
  ])('does not forward advertising conversions without explicit permission (%s)', async (permission) => {
    mockGetIsTrackingAllowed.mockReturnValue(permission as boolean);
    const { sendServerConversion } = await import(
      './ad-tracking-server-conversion'
    );

    await sendServerConversion('PURCHASE', 'event-1', {
      currency: 'NGN',
      value: 1000,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards advertising conversions after ATT authorization', async () => {
    mockGetIsTrackingAllowed.mockReturnValue(true);
    const { sendServerConversion } = await import(
      './ad-tracking-server-conversion'
    );

    await sendServerConversion('PURCHASE', 'event-2', {
      currency: 'NGN',
      value: 1000,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({
      event_id: 'event-2',
      merchant_id: 'merchant-1',
      analytics_consent: true,
      marketing_consent: true,
      targets: ['facebook', 'tiktok', 'snapchat', 'google'],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test/analytics/conversion',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('logs network failures without throwing', async () => {
    const networkError = new Error('Network error');
    mockGetIsTrackingAllowed.mockReturnValue(true);
    mockFetch.mockRejectedValueOnce(networkError);
    const { sendServerConversion } = await import(
      './ad-tracking-server-conversion'
    );

    await expect(
      sendServerConversion('PURCHASE', 'event-3', { value: 500 })
    ).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      'Server conversion error:',
      networkError
    );
  });

  it('logs non-ok responses with their status and body', async () => {
    mockGetIsTrackingAllowed.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Unavailable' }),
      text: async () => 'Unavailable',
    } as Response);
    const { sendServerConversion } = await import(
      './ad-tracking-server-conversion'
    );

    await sendServerConversion('PURCHASE', 'event-4', { value: 500 });

    expect(mockWarn).toHaveBeenCalledWith(
      'Server conversion for PURCHASE returned status 503',
      { error: 'Unavailable' }
    );
  });

  it('aborts timed-out requests without throwing', async () => {
    jest.useFakeTimers();
    mockGetIsTrackingAllowed.mockReturnValue(true);
    mockFetch.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );
    const { sendServerConversion } = await import(
      './ad-tracking-server-conversion'
    );

    const request = sendServerConversion('PURCHASE', 'event-5', { value: 500 });
    await jest.advanceTimersByTimeAsync(5000);

    await expect(request).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(
      'Server conversion timed out after 5000ms'
    );
    jest.useRealTimers();
  });
});
