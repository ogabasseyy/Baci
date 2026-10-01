import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MerchantSetupHero } from './MerchantSetupHero';

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} type="button">
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#ddd',
      gold: '#f5b942',
      goldLight: '#fff5d6',
      primary: '#2563eb',
      text: '#111',
      textSecondary: '#555',
    },
    isDark: true,
  }),
}));

describe('MerchantSetupHero', () => {
  it('keeps the owner step generic before the user completes their name', () => {
    render(<MerchantSetupHero step="owner" />);

    expect(screen.getByText("Let's get to know you")).toBeInTheDocument();
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument();
  });

  it('uses location-focused copy when names are already known', () => {
    render(<MerchantSetupHero ownerFocus="location" step="owner" />);

    expect(screen.getByText('Where is your business?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose your country so we can set currency and local payment options.'
      )
    ).toBeInTheDocument();
  });

  it('welcomes the owner on business setup and exposes the back action', () => {
    const onBack = vi.fn();
    render(
      <MerchantSetupHero firstName="Tester" onBack={onBack} step="business" />
    );

    expect(screen.getByText('Welcome, Tester!')).toBeInTheDocument();
    expect(
      screen.getByText('Add your business details to launch your store.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to about you' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
