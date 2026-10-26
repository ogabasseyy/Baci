import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useGamingSelectionPreviewState } from './use-gaming-selection-preview-state';

describe('Gaming preview merchant-scoped state', () => {
  it('fences stale state updates when the selected merchant changes', () => {
    const { result, rerender } = renderHook(
      ({ merchantId }) => useGamingSelectionPreviewState(merchantId),
      { initialProps: { merchantId: 'merchant-a' } }
    );
    const staleGeneration =
      result.current.currentMerchantRef.current.generation;

    act(() =>
      result.current.setErrorForMerchant(
        'merchant-a',
        staleGeneration,
        'A merchant-specific error'
      )
    );
    expect(result.current.error).toBe('A merchant-specific error');

    rerender({ merchantId: 'merchant-b' });
    act(() =>
      result.current.setErrorForMerchant(
        'merchant-a',
        staleGeneration,
        'Stale merchant error'
      )
    );

    expect(result.current.error).toBeNull();
    expect(result.current.snapshot).toBeNull();
  });
});
