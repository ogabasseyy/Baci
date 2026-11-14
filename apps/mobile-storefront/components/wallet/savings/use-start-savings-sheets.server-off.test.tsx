import { act, renderHook } from '@testing-library/react-native';
import { useStartSavingsSheets } from './use-start-savings-sheets';

describe('useStartSavingsSheets with PiggyVest off', () => {
  it('starts with every sheet closed and opens one at a time', () => {
    const { result } = renderHook(() => useStartSavingsSheets());
    expect(result.current.showPreviewModal).toBe(false);
    expect(result.current.showSuccessModal).toBe(false);
    act(() => result.current.setShowPreviewModal(true));
    expect(result.current.showPreviewModal).toBe(true);
    expect(result.current.showTransferModal).toBe(false);
  });
});
