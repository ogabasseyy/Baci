import { act, renderHook } from '@testing-library/react-native';
import { create } from 'zustand';

const mockStore = create(() => ({
  signInWithOtp: jest.fn(),
  verifyOtp: jest.fn(),
  signInWithGoogle: jest.fn(),
  isLoading: false,
  signInWithPassword: jest.fn(),
  signInWithApple: jest.fn(),
  user: null as { id: string } | null,
  isInitialized: false,
  // Not selected by the hook; changing it must not re-render the screen.
  unrelated: 0,
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    mockStore(selector as never),
}));

import { useLoginAuthStore } from './use-login-auth-store';

describe('useLoginAuthStore', () => {
  it('returns the login slice of the auth store and follows its updates', () => {
    const { result } = renderHook(() => useLoginAuthStore());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();

    act(() => {
      mockStore.setState({ isLoading: true, user: { id: 'u1' } });
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toEqual({ id: 'u1' });
  });

  it('keeps the same result object when only unselected state changes', () => {
    const { result } = renderHook(() => useLoginAuthStore());
    const before = result.current;

    act(() => {
      mockStore.setState({ unrelated: 1 });
    });

    expect(result.current).toBe(before);
  });
});
