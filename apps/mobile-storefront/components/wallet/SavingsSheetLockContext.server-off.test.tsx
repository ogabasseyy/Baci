import { renderHook } from '@testing-library/react-native';
import { useContext } from 'react';
import { SavingsSheetLockContext } from './SavingsSheetLockContext';

// A local UI context only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: SavingsSheetLockContext', () => {
  it('is empty outside the savings sheet', () => {
    const { result } = renderHook(() => useContext(SavingsSheetLockContext));
    expect(result.current).toBeNull();
  });
});
