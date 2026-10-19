import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRefundPinAmountCap } from './use-refund-pin-amount-cap';

const legs = [
  {
    amount: 100,
    gateway: 'paystack',
    id: 'leg-1',
    outstanding: 100,
    reference: 'cap-1',
  },
  {
    amount: 100,
    gateway: 'paystack',
    id: 'leg-2',
    outstanding: 60,
    reference: 'cap-2',
  },
];
const legOptions = [
  { id: 'leg-1', label: 'Paystack · cap-1 · ₦100.00 outstanding' },
  { id: 'leg-2', label: 'Paystack · cap-2 · ₦60.00 outstanding' },
];

function setup(overrides: Record<string, unknown> = {}) {
  const setAmount = vi.fn();
  const setLegId = vi.fn();
  const setMethod = vi.fn();
  const hook = renderHook(
    (props: { amount: string; method: string; pinnedLegId: string | null }) =>
      useRefundPinAmountCap({
        amount: props.amount,
        legOptions,
        legs,
        method: props.method,
        pinnedLegId: props.pinnedLegId,
        remaining: 200,
        setAmount,
        setLegId,
        setMethod,
        ...overrides,
      }),
    {
      initialProps: {
        amount: '',
        method: 'bank_transfer',
        pinnedLegId: null as string | null,
      },
    }
  );
  return { ...hook, setAmount, setLegId, setMethod };
}

describe('useRefundPinAmountCap', () => {
  it('leaves the remainder uncapped without a pin', () => {
    const { result } = setup();

    expect(result.current.effectiveRemaining).toBe(200);
  });

  it('caps the remainder at the pinned capture outstanding', () => {
    const { result, rerender } = setup();
    rerender({ amount: '', method: 'paystack', pinnedLegId: 'leg-2' });

    expect(result.current.effectiveRemaining).toBe(60);
  });

  it('caps a sole capture the RPC pins itself', () => {
    const { result } = renderHook(() =>
      useRefundPinAmountCap({
        amount: '',
        legOptions: legOptions.slice(0, 1),
        legs: legs.slice(0, 1),
        method: 'paystack',
        pinnedLegId: null,
        remaining: 200,
        setAmount: vi.fn(),
        setLegId: vi.fn(),
        setMethod: vi.fn(),
      })
    );

    expect(result.current.effectiveRemaining).toBe(100);
  });

  it('ignores legs for non-Paystack methods', () => {
    const { result, rerender } = setup();
    rerender({ amount: '', method: 'bank_transfer', pinnedLegId: 'leg-1' });

    expect(result.current.effectiveRemaining).toBe(200);
  });

  it('snaps an over-cap prefill when a capture is picked', () => {
    const { result, rerender, setAmount, setLegId } = setup();
    rerender({ amount: '200.00', method: 'paystack', pinnedLegId: null });

    act(() => {
      result.current.handleLegIdChange('leg-2');
    });

    expect(setLegId).toHaveBeenCalledWith('leg-2');
    expect(setAmount).toHaveBeenCalledWith('60.00');
  });

  it('leaves a lower manual amount alone when a capture is picked', () => {
    const { result, rerender, setAmount } = setup();
    rerender({ amount: '50', method: 'paystack', pinnedLegId: null });

    act(() => {
      result.current.handleLegIdChange('leg-2');
    });

    expect(setAmount).not.toHaveBeenCalled();
  });

  it('ignores an unknown capture without snapping', () => {
    const { result, rerender, setAmount } = setup();
    rerender({ amount: '200.00', method: 'paystack', pinnedLegId: null });

    act(() => {
      result.current.handleLegIdChange('leg-9');
    });

    expect(setAmount).not.toHaveBeenCalled();
  });

  it('clears the pin and snaps a sole capture when switching to Paystack', () => {
    const setAmount = vi.fn();
    const setLegId = vi.fn();
    const setMethod = vi.fn();
    const { result } = renderHook(() =>
      useRefundPinAmountCap({
        amount: '200.00',
        legOptions: legOptions.slice(0, 1),
        legs: legs.slice(0, 1),
        method: 'bank_transfer',
        pinnedLegId: null,
        remaining: 200,
        setAmount,
        setLegId,
        setMethod,
      })
    );

    act(() => {
      result.current.handleMethodChange('paystack');
    });

    expect(setMethod).toHaveBeenCalledWith('paystack');
    expect(setLegId).toHaveBeenCalledWith('');
    expect(setAmount).toHaveBeenCalledWith('100.00');
  });
});
