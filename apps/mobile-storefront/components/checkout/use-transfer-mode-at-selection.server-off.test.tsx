import { describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useTransferModeAtSelection } from './use-transfer-mode-at-selection';

describe('bugfix: one-time bank transfer turned wallet-funded at Place Order', () => {
  it('keeps the one-time transfer chosen while wallet transfer was unavailable', () => {
    // Arrange: bank transfer picked while the verdict was unknown.
    const { result } = renderHook(() => useTransferModeAtSelection());
    act(() => {
      result.current.capture('bank_transfer', false);
    });

    // Act: the verdict resolves and wallet transfer becomes eligible.
    const effective = result.current.effective(true);

    // Assert
    expect(effective).toBe(false);
  });

  it('drops wallet transfer if it stops being eligible after selection', () => {
    const { result } = renderHook(() => useTransferModeAtSelection());
    act(() => {
      result.current.capture('bank_transfer', true);
    });

    expect(result.current.effective(false)).toBe(false);
    expect(result.current.effective(true)).toBe(true);
  });
});

describe('server keeps PiggyVest off', () => {
  it('follows current eligibility before any bank transfer is chosen', () => {
    const { result } = renderHook(() => useTransferModeAtSelection());

    expect(result.current.effective(true)).toBe(true);
    expect(result.current.effective(false)).toBe(false);
  });
});
