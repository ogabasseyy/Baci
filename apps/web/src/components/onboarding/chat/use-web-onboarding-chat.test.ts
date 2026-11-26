import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitOnboarding } from '@/app/(platform)/onboarding/actions';
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

vi.mock('@/components/analytics/platform-analytics-provider', () => ({
  trackMerchantSignupStarted: vi.fn(),
  trackMerchantSignupCompleted: vi.fn(),
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

  it('preserves the collected store draft across auth_required at launch and same-user re-auth', async () => {
    const ownerUser = {
      id: 'user-1',
      email: 'ada@example.com',
      user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
    };
    mockGetUser
      .mockResolvedValueOnce({ data: { user: ownerUser } })
      .mockResolvedValueOnce({ data: { user: ownerUser } });
    vi.mocked(submitOnboarding)
      .mockResolvedValueOnce({
        success: false,
        code: 'auth_required',
        message: 'Could not verify your account. Please try again.',
      })
      .mockResolvedValueOnce({
        success: true,
        message: 'Store created!',
        merchantId: 'merchant-1',
        businessName: 'Kicks Hub',
        merchantSlug: 'kicks-hub',
      });

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
    try {
      const { result } = renderHook(() => useWebOnboardingChat());
      await waitFor(() => {
        expect(result.current.step).toBe('country');
      });

      act(() => result.current.handleSelectCountry('NG', 'Nigeria'));
      act(() =>
        result.current.handleQuickReply({ id: 'phone:skip', label: 'Skip' })
      );
      act(() =>
        result.current.handleQuickReply({
          id: 'type:fashion',
          label: 'Fashion',
        })
      );
      act(() => result.current.setInputText('Kicks Hub'));
      act(() => result.current.handleSendText());
      act(() =>
        result.current.handleQuickReply({ id: 'logo:skip', label: 'Skip' })
      );
      act(() =>
        result.current.handleQuickReply({
          id: 'slug:confirm',
          label: 'Looks good',
        })
      );
      expect(result.current.step).toBe('summary');

      // Launch fails with auth_required → drops back to auth_choice.
      act(() =>
        result.current.handleQuickReply({
          id: 'summary:launch',
          label: 'Launch my store',
        })
      );
      await waitFor(() => {
        expect(result.current.step).toBe('auth_choice');
      });

      // Same user re-authenticates via session check → resumes at summary with draft intact.
      act(() =>
        result.current.handleQuickReply({
          id: 'auth:check_session',
          label: "I've confirmed my email",
        })
      );
      await waitFor(() => {
        expect(result.current.step).toBe('summary');
      });
      expect(result.current.data.businessName).toBe('Kicks Hub');
      expect(result.current.data.slug).toBe('kicks-hub');

      // Relaunch submits the exact same business data.
      act(() =>
        result.current.handleQuickReply({
          id: 'summary:launch',
          label: 'Launch my store',
        })
      );
      await waitFor(() => {
        expect(window.location.href).toBe('/dashboard');
      });
      const secondFormData = vi.mocked(submitOnboarding).mock
        .calls[1]?.[1] as FormData;
      expect(secondFormData.get('businessName')).toBe('Kicks Hub');
      expect(secondFormData.get('slug')).toBe('kicks-hub');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
