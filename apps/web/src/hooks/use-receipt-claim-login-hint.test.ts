import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReceiptClaimLoginHint } from './use-receipt-claim-login-hint';

vi.mock('@/lib/customer-login-prefill', () => ({
  fetchCustomerLoginEmailHintForRedirect: vi.fn(),
}));

import { fetchCustomerLoginEmailHintForRedirect } from '@/lib/customer-login-prefill';

const mockedFetchHint = vi.mocked(fetchCustomerLoginEmailHintForRedirect);

describe('useReceiptClaimLoginHint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the masked hint for a claim redirect without prefill', async () => {
    mockedFetchHint.mockResolvedValue('b***@example.com');
    const { result } = renderHook(() =>
      useReceiptClaimLoginHint('/receipts/claim/abc', null)
    );

    await act(async () => {});
    expect(result.current).toBe('b***@example.com');
  });

  it('clears the previous masked hint when navigating between claim redirects', async () => {
    mockedFetchHint.mockImplementation(async (redirectTo: string) => {
      if (redirectTo === '/receipts/claim/first') return 'f***@example.com';
      if (redirectTo === '/receipts/claim/second') {
        // Hold the second lookup open so the stale hint is observable
        // between the redirect change and the fresh fetch resolving.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 's***@example.com';
      }
      return '';
    });

    const { result, rerender } = renderHook(
      ({ redirectTo }: { redirectTo: string }) =>
        useReceiptClaimLoginHint(redirectTo, null),
      { initialProps: { redirectTo: '/receipts/claim/first' } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe('f***@example.com');

    // Act: client-side navigation swaps the claim without remounting.
    rerender({ redirectTo: '/receipts/claim/second' });

    // Assert: the stale first-claim hint clears synchronously, before the
    // second lookup resolves.
    expect(result.current).toBe('');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(result.current).toBe('s***@example.com');
  });

  it('stays empty when a prefill email is present', async () => {
    const { result } = renderHook(() =>
      useReceiptClaimLoginHint('/receipts/claim/first', 'typed@example.com')
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe('');
    expect(mockedFetchHint).not.toHaveBeenCalled();
  });
});
