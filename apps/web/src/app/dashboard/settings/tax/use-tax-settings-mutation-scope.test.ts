// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTaxSettingsMutationScope } from './use-tax-settings-mutation-scope';

describe('useTaxSettingsMutationScope', () => {
  it('invalidates an A request after an A to B to A merchant transition', () => {
    const { result, rerender } = renderHook(
      ({ merchantId }) => useTaxSettingsMutationScope(merchantId),
      { initialProps: { merchantId: 'merchant-a' } }
    );

    let isCurrent = () => false;
    act(() => {
      isCurrent = result.current.beginRequest('vat');
    });
    rerender({ merchantId: 'merchant-b' });
    rerender({ merchantId: 'merchant-a' });

    expect(isCurrent()).toBe(false);
  });

  it('invalidates requests when the form unmounts', () => {
    const { result, unmount } = renderHook(() =>
      useTaxSettingsMutationScope('merchant-a')
    );
    const isCurrent = result.current.beginRequest('taxId');

    unmount();

    expect(isCurrent()).toBe(false);
  });

  it('keeps independent mutation generations current while superseding repeats', () => {
    const { result } = renderHook(() =>
      useTaxSettingsMutationScope('merchant-a')
    );

    const firstVatRequest = result.current.beginRequest('vat');
    const taxIdRequest = result.current.beginRequest('taxId');
    const latestVatRequest = result.current.beginRequest('vat');

    expect(firstVatRequest()).toBe(false);
    expect(taxIdRequest()).toBe(true);
    expect(latestVatRequest()).toBe(true);
  });
});
