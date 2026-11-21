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

  it('uses the buyer session for a bank offer even with a tracking token and reports a reversal', async () => {
    const reference = `BCO-${'a'.repeat(32)}`;
    mockGetSession.mockResolvedValue({
      access_token: 'session-token',
    } as never);
    mockFetchWithTimeout.mockResolvedValue(
      jsonResponse({
        orderId: 'order-1',
        success: false,
        status: 'reversed',
      }) as never
    );

    await expect(
      checkReferenceSettled('order-1', reference, 'track-1')
    ).resolves.toEqual({
      paid: false,
      reconciliation: 'order_skipped',
    });
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/payments\/verify$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reference }),
        headers: expect.objectContaining({
          Authorization: 'Bearer session-token',
        }),
      })
    );
  });

  it('keeps a bank offer pending if only its tracking token is available', async () => {
    await expect(
      checkReferenceSettled('order-1', `BCO-${'a'.repeat(32)}`, 'track-1')
    ).resolves.toEqual({ paid: false, inconclusive: true });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('reports inconclusive with neither session nor token', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(
      checkReferenceSettled('order-1', 'BAC-REF-1', null)
    ).resolves.toEqual({ paid: false, inconclusive: true });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});
