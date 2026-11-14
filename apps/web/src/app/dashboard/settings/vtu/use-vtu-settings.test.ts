// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

import { fetchWithCsrf } from '@/lib/api-client';
import { useVtuSettings } from './use-vtu-settings';

const merchantA = 'merchant-a';
const merchantB = 'merchant-b';
const merchantASettings = {
  vtu_enabled: true,
  vtu_airtime_enabled: true,
  vtu_data_enabled: true,
  vtu_checkout_addon_enabled: false,
  vtu_checkout_addon_amounts: [100],
  vtu_loyalty_reward_enabled: false,
  vtu_merchant_commission_rate: 0.5,
};
const toastMock = vi.fn();

describe('useVtuSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores merchant A fetch data after merchant B becomes active', async () => {
    let resolveMerchantA: ((response: Response) => void) | undefined;
    global.fetch = vi.fn((input: string) => {
      if (input.includes(merchantA)) {
        return new Promise<Response>((resolve) => {
          resolveMerchantA = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...merchantASettings, vtu_enabled: false }),
      } as Response);
    }) as typeof fetch;

    const { result, rerender } = renderHook(
      ({ merchantId }) => useVtuSettings(merchantId, toastMock),
      { initialProps: { merchantId: merchantA } }
    );

    rerender({ merchantId: merchantB });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      resolveMerchantA?.({
        ok: true,
        json: async () => merchantASettings,
      } as Response);
    });

    expect(result.current.settings.vtu_enabled).toBe(false);
  });

  it('does not complete merchant B saving when a merchant A save settles', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue({ ok: true } as Response);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => merchantASettings,
    }) as typeof fetch;
    const { result, rerender } = renderHook(
      ({ merchantId }) => useVtuSettings(merchantId, toastMock),
      { initialProps: { merchantId: merchantA } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveMerchantASave: ((response: Response) => void) | undefined;
    let resolveMerchantBSave: ((response: Response) => void) | undefined;
    vi.mocked(fetchWithCsrf)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveMerchantASave = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveMerchantBSave = resolve;
          })
      );

    act(() => result.current.save());
    rerender({ merchantId: merchantB });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.save());
    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolveMerchantASave?.({ ok: true } as Response);
    });

    expect(result.current.saving).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveMerchantBSave?.({ ok: true } as Response);
    });
    expect(result.current.saving).toBe(false);
  });
});
