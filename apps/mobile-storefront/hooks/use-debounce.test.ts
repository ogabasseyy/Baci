import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useDebounce } from './use-debounce';

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds the previous value until the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 300),
      { initialProps: { value: 'i' } }
    );
    expect(result.current).toBe('i');

    rerender({ value: 'iph' });
    expect(result.current).toBe('i');

    act(() => jest.advanceTimersByTime(300));
    expect(result.current).toBe('iph');
  });

  it('restarts the delay on every keystroke', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 300),
      { initialProps: { value: 'i' } }
    );

    rerender({ value: 'ip' });
    act(() => jest.advanceTimersByTime(250));
    rerender({ value: 'iph' });
    act(() => jest.advanceTimersByTime(250));
    expect(result.current).toBe('i');

    act(() => jest.advanceTimersByTime(50));
    expect(result.current).toBe('iph');
  });
});
