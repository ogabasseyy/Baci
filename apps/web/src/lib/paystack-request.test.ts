import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('paystackRequest', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: { id: 1 }, status: true }),
        ok: true,
        status: 200,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function request() {
    const { paystackRequest } = await import('./paystack-request');
    return paystackRequest;
  }

  it('returns the response data on success', async () => {
    const paystackRequest = await request();

    await expect(paystackRequest('/refund/42')).resolves.toEqual({
      data: { id: 1 },
      success: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.paystack.co/refund/42',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_123',
        }),
      })
    );
  });

  it('reports provider failures with their HTTP code', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ message: 'not found', status: false }),
      ok: false,
      status: 404,
    } as unknown as Response);
    const paystackRequest = await request();

    await expect(paystackRequest('/refund/42')).resolves.toMatchObject({
      code: 'HTTP_404',
      success: false,
    });
  });

  it('preserves the HTTP status when an error body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      ok: false,
      status: 429,
    } as unknown as Response);
    const paystackRequest = await request();

    // A definite 429 rejection must stay retryable: reporting it as
    // NETWORK_ERROR would quarantine the refund as delivery_uncertain
    // instead of retrying after the rate limit.
    await expect(paystackRequest('/refund')).resolves.toMatchObject({
      code: 'HTTP_429',
      error: 'API request failed: 429',
      success: false,
    });
  });

  it('keeps a 2xx response with an unusable body ambiguous', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON')),
      ok: true,
      status: 200,
    } as unknown as Response);
    const paystackRequest = await request();

    // The provider said OK but the body is unusable: a POST may have
    // executed, so acceptance stays unknown instead of reading as a
    // deterministic rejection.
    await expect(paystackRequest('/refund')).resolves.toMatchObject({
      code: 'NETWORK_ERROR',
      success: false,
    });
  });

  it('reports network failures without throwing', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('socket hangup'));
    const paystackRequest = await request();

    await expect(paystackRequest('/refund/42')).resolves.toMatchObject({
      code: 'NETWORK_ERROR',
      error: 'socket hangup',
      success: false,
    });
  });

  it('reports a missing secret without calling the provider', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const { paystackRequest } = await import('./paystack-request');

    await expect(paystackRequest('/refund/42')).resolves.toMatchObject({
      code: 'CONFIG_ERROR',
      success: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
