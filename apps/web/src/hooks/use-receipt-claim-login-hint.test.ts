import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-login-prefill', () => ({
  fetchCustomerLoginEmailHintForRedirect: vi.fn(),
}));

import { fetchCustomerLoginEmailHintForRedirect } from '@/lib/customer-login-prefill';
import { useReceiptClaimLoginHint } from './use-receipt-claim-login-hint';

describe('useReceiptClaimLoginHint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the masked hint for a claim redirect without prefill', async () => {
    vi.mocked(fetchCustomerLoginEmailHintForRedirect).mockResolvedValue(
      'b***@example.com'
    );
    const { result } = renderHook(() =>
      useReceiptClaimLoginHint('/receipts/claim/abc', null)
    );

    await act(async () => {});

    expect(result.current).toBe('b***@example.com');
  });

  it('clears a stale hint when the redirect target changes', async () => {
    vi.mocked(fetchCustomerLoginEmailHintForRedirect).mockImplementation(
      async (redirect) =>
        redirect === '/receipts/claim/first' ? 'f***@example.com' : ''
    );
    const { result, rerender } = renderHook(
      ({ redirect }) => useReceiptClaimLoginHint(redirect, null),
      { initialProps: { redirect: '/receipts/claim/first' } }
    );

    await act(async () => {});
    expect(result.current).toBe('f***@example.com');

    rerender({ redirect: '/receipts/claim/second' });

    // Cleared synchronously on target change, before the next fetch lands.
    expect(result.current).toBe('');
    await act(async () => {});
    expect(result.current).toBe('');
  });

  it('never fetches when a prefill email is present', async () => {
    const { result } = renderHook(() =>
      useReceiptClaimLoginHint('/receipts/claim/abc', 'ada@example.com')
    );

    await act(async () => {});

    expect(result.current).toBe('');
    expect(fetchCustomerLoginEmailHintForRedirect).not.toHaveBeenCalled();
  });
});
