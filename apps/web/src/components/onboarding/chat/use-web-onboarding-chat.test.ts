import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebOnboardingChat } from './use-web-onboarding-chat';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signInWithOAuth: vi.fn(),
      signUp: vi.fn(),
    },
  })),
}));

vi.mock('@/app/(platform)/onboarding/actions', () => ({
  sendMagicLink: vi.fn(),
  submitOnboarding: vi.fn(),
}));

describe('useWebOnboardingChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in auth_choice when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { result } = renderHook(() => useWebOnboardingChat());

    await waitFor(() => {
      expect(result.current.isHydrating).toBe(false);
    });
    expect(result.current.step).toBe('auth_choice');
  });

  it('hydrates directly into store setup country step when user is signed in with name', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
        },
      },
    });
    const { result } = renderHook(() => useWebOnboardingChat());

    await waitFor(() => {
      expect(result.current.step).toBe('country');
    });

    act(() => {
      result.current.handleSelectCountry('NG', 'Nigeria');
    });
    expect(result.current.step).toBe('phone');
    expect(result.current.data.country).toBe('NG');
  });
});
