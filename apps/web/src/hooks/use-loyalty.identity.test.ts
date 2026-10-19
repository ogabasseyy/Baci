import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoyalty } from './use-loyalty';

describe('useLoyalty identity changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('skips the post-enroll refresh when the identity changed mid-flight', async () => {
    const statusUrls: string[] = [];
    let resolveEnroll: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes('/enroll')) {
        return new Promise((resolve) => {
          resolveEnroll = resolve;
        });
      }
      statusUrls.push(url);
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const { result, rerender } = renderHook(
      ({ merchant, customer }: { merchant: string; customer: string }) =>
        useLoyalty(merchant, customer),
      {
        initialProps: { merchant: 'merchant-1', customer: 'customer-1' },
      }
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let enrollPromise: Promise<unknown> | undefined;
    act(() => {
      enrollPromise = result.current.enroll();
    });
    rerender({ merchant: 'merchant-2', customer: 'customer-2' });
    await waitFor(() => {
      expect(
        statusUrls.some((url) => url.includes('merchant_id=merchant-2'))
      ).toBe(true);
    });

    await act(async () => {
      resolveEnroll?.({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { points_balance: 10, tier: 'bronze', referral_code: 'X' },
          }),
      } as Response);
      await enrollPromise;
    });

    expect(
      statusUrls.filter((url) => url.includes('merchant_id=merchant-1'))
    ).toHaveLength(1);
  });
});
