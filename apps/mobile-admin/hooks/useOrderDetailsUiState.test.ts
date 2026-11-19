// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOrderDetailsUiState } from './useOrderDetailsUiState';

describe('useOrderDetailsUiState', () => {
  it('initialises with all modals hidden and fields empty', () => {
    const { result } = renderHook(() => useOrderDetailsUiState());
    expect(result.current.showStatusModal).toBe(false);
    expect(result.current.showCreditModal).toBe(false);
    expect(result.current.showShipmentFlow).toBe(false);
    expect(result.current.showPaymentOptionModal).toBe(false);
    expect(result.current.showRecordPaymentModal).toBe(false);
    expect(result.current.showReceiptPreview).toBe(false);
    expect(result.current.creditNotes).toBe('');
    expect(result.current.riderPhone).toBe('');
    expect(result.current.shipmentFlowStep).toBe('details');
    expect(result.current.successModal.visible).toBe(false);
  });

  it('opens the status modal', () => {
    const { result } = renderHook(() => useOrderDetailsUiState());
    act(() => {
      result.current.setShowStatusModal(true);
    });
    expect(result.current.showStatusModal).toBe(true);
  });

  it('updates riderPhone', () => {
    const { result } = renderHook(() => useOrderDetailsUiState());
    act(() => {
      result.current.setRiderPhone('08034444444');
    });
    expect(result.current.riderPhone).toBe('08034444444');
  });

  it('transitions shipmentFlowStep', () => {
    const { result } = renderHook(() => useOrderDetailsUiState());
    act(() => {
      result.current.setShipmentFlowStep('method');
    });
    expect(result.current.shipmentFlowStep).toBe('method');
  });
});
