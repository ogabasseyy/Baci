import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockJuicywayRequest = vi.fn();

vi.mock('./client', () => ({
  JUICYWAY_BASE_URL: 'https://sandbox.spendjuice.com',
  JUICYWAY_SECRET_KEY: 'sk_test_key',
  juicywayRequest: (...args: unknown[]) => mockJuicywayRequest(...args),
}));

import { getPaymentSession } from './payments';

describe('getPaymentSession abort signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the abort signal to the session lookup request', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    mockJuicywayRequest.mockResolvedValue({
      data: { id: sessionId, status: 'succeeded' },
      success: true,
    });
    const signal = AbortSignal.timeout(1000);

    await getPaymentSession(sessionId, signal);

    expect(mockJuicywayRequest).toHaveBeenCalledWith(
      `/payment-sessions/${sessionId}`,
      { method: 'GET', signal }
    );
  });
});
