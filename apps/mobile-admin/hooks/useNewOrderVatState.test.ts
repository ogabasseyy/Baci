// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNewOrderVatState } from './useNewOrderVatState';

describe('useNewOrderVatState', () => {
  it('initializes isVatApplied from the merchant VAT registration', () => {
    const { result } = renderHook(() =>
      useNewOrderVatState(true, 'registered')
    );

    expect(result.current.isVatRegistered).toBe(true);
    expect(result.current.isVatApplied).toBe(true);
  });

  it('starts with VAT off for unregistered merchants', () => {
    const { result } = renderHook(() => useNewOrderVatState(true, 'pending'));

    expect(result.current.isVatRegistered).toBe(false);
    expect(result.current.isVatApplied).toBe(false);
  });

  it('auto-enables VAT when registration turns on and autoApplyVat is set', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: string | null | undefined }) =>
        useNewOrderVatState(true, status),
      { initialProps: { status: 'pending' as string | null | undefined } }
    );

    expect(result.current.isVatApplied).toBe(false);

    rerender({ status: 'registered' });

    expect(result.current.isVatApplied).toBe(true);
  });

  it('does not auto-enable VAT when autoApplyVat is disabled', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: string | null | undefined }) =>
        useNewOrderVatState(false, status),
      { initialProps: { status: 'pending' as string | null | undefined } }
    );

    rerender({ status: 'registered' });

    expect(result.current.isVatRegistered).toBe(true);
    expect(result.current.isVatApplied).toBe(false);
  });

  it('clears VAT when merchant registration turns off mid-draft', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: string | null | undefined }) =>
        useNewOrderVatState(true, status),
      { initialProps: { status: 'registered' as string | null | undefined } }
    );

    expect(result.current.isVatApplied).toBe(true);

    rerender({ status: 'pending' });

    expect(result.current.isVatRegistered).toBe(false);
    expect(result.current.isVatApplied).toBe(false);
  });

  it('keeps a manual VAT toggle until registration changes', () => {
    const { result } = renderHook(() =>
      useNewOrderVatState(true, 'registered')
    );

    act(() => {
      result.current.setIsVatApplied(false);
    });

    expect(result.current.isVatApplied).toBe(false);
  });
});
