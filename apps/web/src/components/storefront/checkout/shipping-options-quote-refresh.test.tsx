import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShippingQuoteRefresh } from './shipping-options-quote-refresh';
import { requestShippingOptions } from './shipping-options-quote-request';

vi.mock('./shipping-options-quote-request', () => ({
  requestShippingOptions: vi.fn(),
}));

const mockRequest = vi.mocked(requestShippingOptions);

function quote(id: string, price: number) {
  return {
    id,
    provider: 'GIGL',
    serviceTier: 'GoStandard',
    carrierName: 'GIG Logistics',
    displayName: `GIG Logistics - ${id}`,
    estimatedDays: 2,
    price,
    currency: 'NGN',
    pickupIncluded: true,
    insuranceIncluded: true,
  };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: 'merchant-1',
    receiverCity: 'Lagos',
    receiverState: 'Lagos',
    receiverAddress: '12 Station Road',
    receiverPhone: '08012345678',
    receiverName: 'Ada Lovelace',
    cartItems: [{ name: 'Phone', quantity: 1, price: 50000 }],
    cartSubtotal: 50000,
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe('useShippingQuoteRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips the fetch until city and state have enough characters', async () => {
    renderHook(() =>
      useShippingQuoteRefresh(params({ receiverCity: 'L', receiverState: '' }))
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('auto-selects the cheapest quote from a fresh response', async () => {
    const onSelect = vi.fn();
    mockRequest.mockResolvedValue({
      quotes: [quote('q-expensive', 9000), quote('q-cheap', 4500)],
      sessionId: 'session-1',
    });
    const { result } = renderHook(() =>
      useShippingQuoteRefresh(params({ onSelect }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(result.current.quotes).toHaveLength(2);
    expect(result.current.sessionId).toBe('session-1');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-cheap' }),
      'session-1'
    );
  });

  it('clears a stale parent selection when the fresh response is empty', async () => {
    const onSelect = vi.fn();
    mockRequest.mockResolvedValue({ quotes: [], sessionId: 'session-2' });
    renderHook(() =>
      useShippingQuoteRefresh(params({ onSelect, selectedQuoteId: 'q-old' }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(onSelect).toHaveBeenCalledWith(null, 'session-2');
  });

  it('surfaces an error and clears the selection when the refresh fails', async () => {
    const onSelect = vi.fn();
    mockRequest.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      useShippingQuoteRefresh(params({ onSelect, selectedQuoteId: 'q-old' }))
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(result.current.error).toBe(
      'Unable to get shipping options. Please try again.'
    );
    expect(onSelect).toHaveBeenCalledWith(null, '');
  });
});
