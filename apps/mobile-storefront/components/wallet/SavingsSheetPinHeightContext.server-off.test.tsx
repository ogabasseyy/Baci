import { renderHook } from '@testing-library/react-native';
import { useContext } from 'react';
import { SavingsSheetPinHeightContext } from './SavingsSheetPinHeightContext';

// A local UI context only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: SavingsSheetPinHeightContext', () => {
  it('is empty outside the savings sheet', () => {
    const { result } = renderHook(() =>
      useContext(SavingsSheetPinHeightContext)
    );
    expect(result.current).toBeNull();
  });
});
