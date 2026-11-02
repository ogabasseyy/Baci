import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { SettingsFormValues, settingsSchema } from './settings-utils';
import { useStorefrontProfileBaselineRefresh } from './use-storefront-profile-baseline-refresh';

const refreshMerchantSettingsSnapshot = vi.hoisted(() => vi.fn());
vi.mock('./refresh-merchant-settings-snapshot', () => ({
  refreshMerchantSettingsSnapshot: (...args: unknown[]) =>
    refreshMerchantSettingsSnapshot(...args),
}));

const baseline = {
  business_name: 'Store',
  country: 'NG',
  phone: '+2348012345678',
  site_description: 'Old description',
  support_email: 'old@example.com',
  support_phone: '+2348000000000',
  updated_at: '2026-08-04T10:00:00.000Z',
};

describe('useStorefrontProfileBaselineRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances the canonical baseline without overwriting later local edits', async () => {
    const profileBaselineRef = { current: { ...baseline } };
    const localDescription = 'Draft written during save';
    const snapshot = {
      ...baseline,
      business_name: 'Saved Store',
      updated_at: '2026-08-04T11:00:00.000Z',
    };
    refreshMerchantSettingsSnapshot.mockResolvedValue(snapshot);
    const { result } = renderHook(() => {
      const form = useForm<
        z.input<typeof settingsSchema>,
        unknown,
        SettingsFormValues
      >({ defaultValues: baseline });
      const refresh = useStorefrontProfileBaselineRefresh({
        activeMerchantIdRef: { current: 'merchant-1' },
        form,
        profileBaselineRef,
      });
      return { form, refresh };
    });
    act(() => {
      result.current.form.setValue('site_description', localDescription);
    });
    const reset = vi.spyOn(result.current.form, 'reset');
    const setValue = vi.spyOn(result.current.form, 'setValue');

    await act(() => result.current.refresh('merchant-1'));

    expect(profileBaselineRef.current).toEqual(snapshot);
    expect(reset).toHaveBeenCalledWith(snapshot);
    expect(setValue).toHaveBeenCalledWith(
      'site_description',
      localDescription,
      { shouldDirty: true }
    );
  });

  it('ignores an older overlapping refresh that resolves last', async () => {
    let resolveOlder: ((value: typeof baseline) => void) | undefined;
    const olderRefresh = new Promise<typeof baseline>((resolve) => {
      resolveOlder = resolve;
    });
    const newerSnapshot = {
      ...baseline,
      business_name: 'Newest Store',
      updated_at: '2026-08-04T12:00:00.000Z',
    };
    refreshMerchantSettingsSnapshot
      .mockReturnValueOnce(olderRefresh)
      .mockResolvedValueOnce(newerSnapshot);
    const profileBaselineRef = { current: { ...baseline } };
    const { result } = renderHook(() => {
      const form = useForm<
        z.input<typeof settingsSchema>,
        unknown,
        SettingsFormValues
      >({ defaultValues: baseline });
      const refresh = useStorefrontProfileBaselineRefresh({
        activeMerchantIdRef: { current: 'merchant-1' },
        form,
        profileBaselineRef,
      });
      return { form, refresh };
    });
    const reset = vi.spyOn(result.current.form, 'reset');

    const older = result.current.refresh('merchant-1');
    await act(() => result.current.refresh('merchant-1'));
    resolveOlder?.({
      ...baseline,
      business_name: 'Older Store',
      updated_at: '2026-08-04T11:00:00.000Z',
    });
    await act(() => older);

    expect(profileBaselineRef.current).toEqual(newerSnapshot);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith(newerSnapshot);
  });
});
