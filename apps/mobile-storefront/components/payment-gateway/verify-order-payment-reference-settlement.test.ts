import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { getSession } from '@/lib/supabase';
import { checkReferenceSettled } from './verify-order-payment-reference-settlement';

jest.mock('@/lib/supabase', () => ({
  getSession: jest.fn(),
}));

jest.mock('@/lib/fetch-with-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

const mockGetSession = jest.mocked(getSession);
const mockFetchWithTimeout = jest.mocked(fetchWithTimeout);

function jsonResponse(body: unknown) {
  return {
    json: async () => body,
    ok: true,
  };
}

describe('checkReferenceSettled transport selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
  });

  it('uses the proof-bound GET when a tracking token is available, even with a session', async () => {
    mockGetSession.mockResolvedValue({
      access_token: 'session-token',
    } as never);
    mockFetchWithTimeout.mockResolvedValue(jsonResponse({}) as never);

    await checkReferenceSettled(
      'order-1',
      'WALLET-DVA-ORDER-order-1',
      'track-1'
    );

    // The Bearer POST path only settles locally finalized Paystack,
    // Korapay, and Juicyway rows: wallet and async BNPL references need
    // the gateway-agnostic proof-bound GET.
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/payments/verify?reference=WALLET-DVA-ORDER-order-1&trackingToken=track-1'
      ),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('uses the Bearer POST when a session exists without a tracking token', async () => {
    mockGetSession.mockResolvedValue({
      access_token: 'session-token',
    } as never);
    mockFetchWithTimeout.mockResolvedValue(jsonResponse({}) as never);

    await checkReferenceSettled('order-1', 'BAC-REF-1', null);

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.not.stringContaining('trackingToken='),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer session-token',
        }),
      })
    );
  });

  it('reports inconclusive with neither session nor token', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(
      checkReferenceSettled('order-1', 'BAC-REF-1', null)
    ).resolves.toEqual({ paid: false, inconclusive: true });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});
