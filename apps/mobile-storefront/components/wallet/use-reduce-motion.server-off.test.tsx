import { renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotion } from './use-reduce-motion';

describe('useReduceMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps motion reduced until the device preference is known', () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBe(true);
  });

  it('turns on when the device asks for reduced motion', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const { result } = renderHook(() => useReduceMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });
});

it('enables animation only after the device explicitly allows motion', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const { result } = renderHook(() => useReduceMotion());
  await waitFor(() => expect(result.current).toBe(false));
});
