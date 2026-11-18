import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usdtWalletFundingApi } from './usdt-wallet-funding-api';
import {
  MAX_USDT_POLL_ATTEMPTS,
  USDT_POLL_INTERVAL_MS,
  useUsdtWalletFundingPolling,
} from './use-usdt-wallet-funding-polling';

vi.mock('./usdt-wallet-funding-api', () => ({
  usdtWalletFundingApi: {
    initialize: vi.fn(),
    status: vi.fn(),
  },
}));

describe('useUsdtWalletFundingPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses when hidden, stops at max attempts, and allows manual restart to complete', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState'
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    vi.mocked(usdtWalletFundingApi.status).mockResolvedValue({
      amount: 10,
      chain: 'TRX',
      depositAddress: 'TAddr123',
      fundingStatus: 'pending',
      kind: 'ready',
    });

    const onFunded = vi.fn();
    const onFundingChange = vi.fn();

    try {
      const { result } = renderHook(() =>
        useUsdtWalletFundingPolling({
          funding: {
            address: 'TAddr123',
            reference: 'ref-1',
            status: 'pending',
          },
          merchantSlug: 'ogabassey',
          onAmountChange: vi.fn(),
          onChainChange: vi.fn(),
          onFunded,
          onFundingChange,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(USDT_POLL_INTERVAL_MS * 3);
      });
      expect(usdtWalletFundingApi.status).not.toHaveBeenCalled();

      visibility = 'visible';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(
          USDT_POLL_INTERVAL_MS * (MAX_USDT_POLL_ATTEMPTS + 5)
        );
      });

      expect(usdtWalletFundingApi.status).toHaveBeenCalledTimes(
        MAX_USDT_POLL_ATTEMPTS
      );
      expect(result.current.pollingExhausted).toBe(true);
      expect(onFunded).not.toHaveBeenCalled();

      vi.mocked(usdtWalletFundingApi.status).mockResolvedValueOnce({
        amount: 10,
        chain: 'TRX',
        depositAddress: 'TAddr123',
        fundingStatus: 'completed',
        kind: 'ready',
      });

      await act(async () => {
        result.current.restartPolling();
        await Promise.resolve();
      });

      expect(result.current.pollingExhausted).toBe(false);
      expect(onFunded).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalDescriptor);
      }
    }
  });
});
