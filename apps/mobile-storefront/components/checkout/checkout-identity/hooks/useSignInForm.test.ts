import type { User } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { create as mockCreate } from 'zustand';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockTriggerHaptic = jest.fn();
const mockSignInWithGoogle = jest.fn();
const mockSignInWithApple = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
    },
  },
}));

jest.mock('./useHapticFeedback', () => ({
  useHapticFeedback: () => ({
    triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
  }),
}));

jest.mock('@/stores/auth-store', () => {
  return {
    useAuthStore: mockCreate(() => ({
      signInWithApple: (...args: unknown[]) => mockSignInWithApple(...args),
      signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
      user: null,
    })),
  };
});

import { useAuthStore } from '@/stores/auth-store';
import { useSignInForm } from './useSignInForm';

function makeUser(id: string): User {
  return {
    id,
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2026-04-03T00:00:00.000Z',
    email: `${id}@example.com`,
    role: 'authenticated',
    updated_at: '2026-04-03T00:00:00.000Z',
    user_metadata: {},
  } as User;
}

describe('useSignInForm', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSignInWithGoogle.mockResolvedValue({ success: true });
    mockSignInWithApple.mockResolvedValue({ success: true });

    act(() => {
      useAuthStore.setState({
        signInWithApple: (...args: unknown[]) => mockSignInWithApple(...args),
        signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
        user: null,
      });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets error when Apple sign-in fails', async () => {
    mockSignInWithApple.mockResolvedValue({
      success: false,
      error: 'Apple sign-in failed. Please try again.',
    });

    const onSuccess = jest.fn();
    const { result } = renderHook(() => useSignInForm({ onSuccess }));

    await act(async () => {
      await result.current.handleAppleSignIn();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      'Apple sign-in failed. Please try again.'
    );
  });

  it('sets error when sign-in with invalid credentials fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase');
    supabase.auth.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
      data: { user: null, session: null },
    });

    const onSuccess = jest.fn();
    const { result } = renderHook(() => useSignInForm({ onSuccess }));

    await act(async () => {
      result.current.setValue('email', 'test@example.com');
      result.current.setValue('password', 'wrongpassword');
    });

    await act(async () => {
      await result.current.handleSignIn();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it('reacts to Google auth state changes after the browser round-trip', async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useSignInForm({ onSuccess }));

    await act(async () => {
      await result.current.handleGoogleSignIn();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({ user: makeUser('google-user') });
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });
  });

  it('recovers from a stalled social sign-in if auth state never updates', async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useSignInForm({ onSuccess }));

    await act(async () => {
      await result.current.handleGoogleSignIn();
    });

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('Sign-in timed out. Please try again.');
  });
});
