import { renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotion } from './use-reduce-motion';

describe('useReduceMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is off by default', () => {
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);
  });

  it('turns on when the device asks for reduced motion', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const { result } = renderHook(() => useReduceMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
