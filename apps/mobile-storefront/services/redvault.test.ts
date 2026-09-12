import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockResolveCheckoutAuth =
  jest.fn<() => Promise<{ authorizationHeaders: Record<string, string> }>>();
const mockReadCheckoutStoredSession =
  jest.fn<() => Promise<{ session: null }>>();
const mockFetch = jest.fn<typeof fetch>();

jest.mock('./orders-auth', () => ({
  resolveCheckoutAuth: () => mockResolveCheckoutAuth(),
}));

jest.mock('./orders-session', () => ({
  getCheckoutStoredSession: jest.fn(),
}));

jest.mock('./read-checkout-stored-session', () => ({
  readCheckoutStoredSession: () => mockReadCheckoutStoredSession(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: {} },
  supabaseAuthStorage: {},
  supabaseAuthStorageKey: 'session',
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('getRedvaultPaymentAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockReadCheckoutStoredSession.mockResolvedValue({ session: null });
    mockResolveCheckoutAuth.mockResolvedValue({ authorizationHeaders: {} });
  });

  it('uses the storefront API and hides the choice when availability is not affirmative', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        available: false,
        reason: 'provider_evidence_missing',
      }),
    } as Response);
    const { getRedvaultPaymentAvailability } = await import('./redvault');

    await expect(getRedvaultPaymentAvailability(merchantId)).resolves.toBe(
      false
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/api/payments/redvault/availability',
        search: `?merchant_id=${merchantId}`,
      }),
      expect.objectContaining({ headers: {}, cache: 'no-store' })
    );
  });

  it('fails closed when the availability request errors', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { getRedvaultPaymentAvailability } = await import('./redvault');

    await expect(getRedvaultPaymentAvailability(merchantId)).resolves.toBe(
      false
    );
  });

  it('rejects another merchant before making an availability request', async () => {
    const { getRedvaultPaymentAvailability } = await import('./redvault');

    await expect(
      getRedvaultPaymentAvailability('11111111-1111-4111-8111-111111111111')
    ).resolves.toBe(false);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
