import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNegotiationModalController } from './use-negotiation-modal-controller';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./negotiation-live-vat', () => ({
  readNegotiationVatRate: mocks.read,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
const options = {
  currentPrice: 1001,
  isOpen: true,
  merchantId: 'merchant-1',
  merchantSlug: 'shop',
  onSuccess: vi.fn(),
  productName: 'Phone',
  type: 'single' as const,
};
beforeEach(() => {
  vi.useFakeTimers();
  mocks.read.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});
async function submit(result: {
  current: ReturnType<typeof useNegotiationModalController>;
}) {
  act(() => result.current.setOffer('500'));
  act(() => result.current.handleSubmit({ preventDefault() {} } as never));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
}
async function advanceToFinal(result: {
  current: ReturnType<typeof useNegotiationModalController>;
}) {
  await submit(result);
  act(() => result.current.setStatus('input'));
  await submit(result);
  act(() => result.current.setStatus('input'));
}
it.each([
  [0, 980],
  [0.075, 981],
])('uses fresh rate %s for final counteroffer', async (rate, expected) => {
  mocks.read.mockResolvedValue(rate);
  const { result } = renderHook(() => useNegotiationModalController(options));
  await advanceToFinal(result);
  expect(mocks.read).not.toHaveBeenCalled();
  await submit(result);
  expect(result.current.counterOffer).toBe(expected);
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
it('fails closed with a retryable message on lookup failure', async () => {
  mocks.read.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useNegotiationModalController(options));
  await advanceToFinal(result);
  await submit(result);
  expect(result.current.status).toBe('input');
  expect(result.current.message).toMatch(/try again/i);
  expect(result.current.attemptCount).toBe(2);
  expect(result.current.counterOffer).toBeNull();
  mocks.read.mockResolvedValue(0.075);
  await submit(result);
  expect(result.current.counterOffer).toBe(981);
});
it('discards a stale lookup after the modal closes and reopens', async () => {
  const pending = Promise.withResolvers<number>();
  mocks.read.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(
    ({ isOpen }) => useNegotiationModalController({ ...options, isOpen }),
    { initialProps: { isOpen: true } }
  );
  await advanceToFinal(result);
  act(() => result.current.setOffer('500'));
  act(() => result.current.handleSubmit({ preventDefault() {} } as never));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  rerender({ isOpen: false });
  rerender({ isOpen: true });
  await act(async () => {
    pending.resolve(0.075);
    await Promise.resolve();
  });
  expect(result.current.status).toBe('input');
  expect(result.current.counterOffer).toBeNull();
});

it('discards a pending quote when the active merchant changes', async () => {
  const pending = Promise.withResolvers<number>();
  mocks.read.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(
    ({ merchantId }) =>
      useNegotiationModalController({ ...options, merchantId }),
    { initialProps: { merchantId: 'merchant-1' } }
  );
  await advanceToFinal(result);
  act(() => result.current.setOffer('500'));
  act(() => result.current.handleSubmit({ preventDefault() {} } as never));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  rerender({ merchantId: 'merchant-2' });
  await act(async () => {
    pending.resolve(0.075);
    await Promise.resolve();
  });
  expect(result.current.status).toBe('input');
  expect(result.current.counterOffer).toBeNull();
  expect(result.current.attemptCount).toBe(0);
});

it('cancels an earlier merchant timer before the lookup starts', async () => {
  const { result, rerender } = renderHook(
    ({ merchantId }) =>
      useNegotiationModalController({ ...options, merchantId }),
    { initialProps: { merchantId: 'merchant-1' } }
  );
  await advanceToFinal(result);
  act(() => result.current.setOffer('500'));
  act(() => result.current.handleSubmit({ preventDefault() {} } as never));
  rerender({ merchantId: 'merchant-2' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(result.current.status).toBe('input');
});
