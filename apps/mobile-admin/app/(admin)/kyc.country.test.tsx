import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  country: 'NG' as string | null,
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
}));

vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
}));

vi.mock('@/components/kyc/kyc-screen.styles', () => ({ styles: {} }));

vi.mock('@/components/kyc/NinVerificationCard', () => ({
  default: () => <button type="button">Verify identity</button>,
}));

vi.mock('@/components/kyc/CacVerificationCard', () => ({
  default: () => <button type="button">Verify CAC</button>,
}));

vi.mock('@/components/ui/AppKeyboardContainer', () => ({
  AppKeyboardContainer: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: {
      bvn: null,
      cac_rc_number: null,
      country: mocks.country,
      id: 'merchant-1',
      nin: null,
      phone: '+2348012345678',
      user_id: 'user-1',
    },
  }),
}));

vi.mock('@/hooks/useKycVerificationRefresh', () => ({
  useKycVerificationRefresh: () => ({
    refreshAfterVerification: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#020617',
      card: '#111827',
      error: '#ef4444',
      primary: '#3b82f6',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      textSecondary: '#94a3b8',
    },
    isDark: true,
  }),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Pressable: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StatusBar: () => null,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import KYCScreen from './kyc';

describe('KYCScreen country availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.country = 'NG';
    mocks.useQuery.mockReturnValue({
      data: {
        bvn_verified: false,
        cac_verified: false,
        nin_verified: false,
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it('renders Nigerian identity and CAC verification flows', () => {
    render(<KYCScreen />);

    expect(
      screen.getByRole('button', { name: /verify identity/i })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /verify cac/i })).toBeVisible();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it('hides Nigerian-only flows for a non-Nigerian merchant', () => {
    mocks.country = 'IN';

    render(<KYCScreen />);

    expect(
      screen.getByText(
        /identity verification is only available for nigerian merchants/i
      )
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /verify identity/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /verify cac/i })
    ).not.toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('keeps identity flows enabled for legacy merchants without a country', () => {
    mocks.country = null;

    render(<KYCScreen />);

    expect(
      screen.getByRole('button', { name: /verify identity/i })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /verify cac/i })).toBeVisible();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
