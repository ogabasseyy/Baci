import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatCartCheckoutReviewExpiry } from './use-chat-cart-checkout-review-expiry';

afterEach(() => vi.restoreAllMocks());

describe('useChatCartCheckoutReviewExpiry', () => {
  it.each([
    {
      epochDeadlineMs: 20_000,
      epochNowMs: 10_000,
      monotonicDeadlineMs: 1_000,
      monotonicNowMs: 1_000,
      name: 'monotonic deadline',
    },
    {
      epochDeadlineMs: 20_000,
      epochNowMs: 20_000,
      monotonicDeadlineMs: 2_000,
      monotonicNowMs: 1_000,
      name: 'epoch deadline',
    },
    {
      epochDeadlineMs: 20_000,
      epochNowMs: 10_000,
      monotonicDeadlineMs: Number.NaN,
      monotonicNowMs: 1_000,
      name: 'non-finite deadline',
    },
  ])('invalidates when the $name is reached or invalid', (clocks) => {
    vi.spyOn(performance, 'now').mockReturnValue(clocks.monotonicNowMs);
    vi.spyOn(Date, 'now').mockReturnValue(clocks.epochNowMs);

    const { result } = renderHook(() =>
      useChatCartCheckoutReviewExpiry(
        clocks.monotonicDeadlineMs,
        clocks.epochDeadlineMs
      )
    );

    expect(result.current).toBe(true);
  });
});
