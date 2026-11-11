// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNewOrderUiState } from './useNewOrderUiState';

describe('useNewOrderUiState', () => {
  it('initialises with all modals closed', () => {
    const { result } = renderHook(() => useNewOrderUiState());
    expect(result.current.showProductModal).toBe(false);
    expect(result.current.showCustomItemModal).toBe(false);
    expect(result.current.showFinancialModal).toEqual({
      type: 'discount',
      visible: false,
    });
  });

  it('toggles showFinancialModal', () => {
    const { result } = renderHook(() => useNewOrderUiState());
    act(() => {
      result.current.setShowFinancialModal({ type: 'shipping', visible: true });
    });
    expect(result.current.showFinancialModal).toEqual({
      type: 'shipping',
      visible: true,
    });
  });

  it('toggles showProductModal', () => {
    const { result } = renderHook(() => useNewOrderUiState());
    act(() => {
      result.current.setShowProductModal(true);
    });
    expect(result.current.showProductModal).toBe(true);
  });

  it('toggles showCustomItemModal', () => {
    const { result } = renderHook(() => useNewOrderUiState());
    act(() => {
      result.current.setShowCustomItemModal(true);
    });
    expect(result.current.showCustomItemModal).toBe(true);
  });
});
