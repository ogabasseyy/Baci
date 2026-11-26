import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebOnboardingChat } from './use-web-onboarding-chat';

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signInWithOAuth: vi.fn(),
      signUp: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
        })),
      })),
    })),
  })),
}));

vi.mock('@/app/(platform)/onboarding/actions', () => ({
  sendMagicLink: vi.fn(),
  submitOnboarding: vi.fn(),
}));

describe('useWebOnboardingChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
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

  it('redirects already-completed merchants to /dashboard during hydration', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-completed',
          email: 'live@example.com',
          user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
        },
      },
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { business_name: 'Existing Store' },
      error: null,
    });
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
    try {
      const { result } = renderHook(() => useWebOnboardingChat());
      await waitFor(() => {
        expect(window.location.href).toBe('/dashboard');
      });
      expect(result.current.step).toBe('auth_choice');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('falls through to store setup during hydration when the merchant lookup rejects', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-transient',
          email: 'ada@example.com',
          user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
        },
      },
    });
    mockMaybeSingle.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useWebOnboardingChat());

    await waitFor(() => {
      expect(result.current.isHydrating).toBe(false);
    });
    expect(result.current.step).toBe('country');
  });
});
