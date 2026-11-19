import { renderHook } from '@testing-library/react-native';
import { useContext } from 'react';
import { SavingsSheetPinCancelContext } from './SavingsSheetPinCancelContext';

// A plain React context: no server involved, PiggyVest on or off.
it('is empty outside the savings sheet', () => {
  const { result } = renderHook(() => useContext(SavingsSheetPinCancelContext));
  expect(result.current).toBeNull();
});
