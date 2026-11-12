import { act, renderHook } from '@testing-library/react-native';
import { notifySavings, useSavingsNotice } from './savings-notice';

// The savings notice is local UI state; it never needs the server.
describe('server keeps PiggyVest off: savings notice', () => {
  afterEach(() => {
    const { result } = renderHook(() => useSavingsNotice());
    act(() => result.current.clear());
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useSavingsNotice());
    expect(result.current.notice).toBeNull();
  });

  it('shows a notice with the info tone by default', () => {
    const { result } = renderHook(() => useSavingsNotice());
    act(() => notifySavings('Contribution pending', 'Waiting on PiggyVest.'));
    expect(result.current.notice).toEqual({
      title: 'Contribution pending',
      message: 'Waiting on PiggyVest.',
      tone: 'info',
    });
  });

  it('replaces the previous notice with a newer one', () => {
    const { result } = renderHook(() => useSavingsNotice());
    act(() => notifySavings('Contribution pending', 'Waiting.', 'info'));
    act(() => notifySavings('Savings updated', 'Nice!', 'success'));
    expect(result.current.notice).toEqual({
      title: 'Savings updated',
      message: 'Nice!',
      tone: 'success',
    });
  });

  it('clears the notice', () => {
    const { result } = renderHook(() => useSavingsNotice());
    act(() => notifySavings('Status unavailable', undefined, 'warning'));
    expect(result.current.notice?.tone).toBe('warning');
    act(() => result.current.clear());
    expect(result.current.notice).toBeNull();
  });
});
