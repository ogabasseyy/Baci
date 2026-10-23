import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useGamingSelectionPreviewGeneration } from './use-gaming-selection-preview-generation';

describe('useGamingSelectionPreviewGeneration', () => {
  it('advances the generation when the merchant changes', () => {
    const { result, rerender } = renderHook(
      ({ merchantId }) => useGamingSelectionPreviewGeneration(merchantId),
      { initialProps: { merchantId: 'merchant-1' } }
    );
    const originalGeneration = result.current.current.generation;

    rerender({ merchantId: 'merchant-2' });

    expect(result.current.current.merchantId).toBe('merchant-2');
    expect(result.current.current.generation).toBeGreaterThan(
      originalGeneration
    );
  });

  it('invalidates pending work when the hook unmounts', () => {
    const { result, unmount } = renderHook(() =>
      useGamingSelectionPreviewGeneration('merchant-1')
    );
    const generation = result.current;
    const beforeUnmount = generation.current.generation;

    unmount();

    expect(generation.current.generation).toBeGreaterThan(beforeUnmount);
  });
});
