import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MerchantSetupProgress } from './MerchantSetupProgress';

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({
    accessibilityLabel,
    accessibilityValue,
    children,
  }: {
    accessibilityLabel?: string;
    accessibilityValue?: { max: number; min: number; now: number };
    children?: ReactNode;
  }) => (
    <div
      aria-label={accessibilityLabel}
      aria-valuemax={accessibilityValue?.max}
      aria-valuemin={accessibilityValue?.min}
      aria-valuenow={accessibilityValue?.now}
      role="progressbar"
    >
      {children}
    </div>
  ),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#ddd',
      card: '#fff',
      primary: '#2563eb',
      primaryLight: '#dbeafe',
      text: '#111',
      textOnPrimary: '#fff',
      textSecondary: '#555',
    },
  }),
}));

describe('MerchantSetupProgress', () => {
  it('communicates the owner-details step and both stage labels', () => {
    render(<MerchantSetupProgress step={1} />);

    const progress = screen.getByRole('progressbar', {
      name: 'Setup progress: step 1 of 2',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('About you')).toBeInTheDocument();
    expect(screen.getByText('Your business')).toBeInTheDocument();
  });

  it('communicates the final business-details step', () => {
    render(<MerchantSetupProgress step={2} />);

    expect(
      screen.getByRole('progressbar', {
        name: 'Setup progress: step 2 of 2',
      })
    ).toHaveAttribute('aria-valuenow', '2');
  });

  it('returns to about-you details when its completed stage is pressed', () => {
    const onAboutYouPress = vi.fn();
    render(
      <MerchantSetupProgress step={2} onAboutYouPress={onAboutYouPress} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'About you' }));

    expect(onAboutYouPress).toHaveBeenCalledOnce();
  });

  it('does not return to about-you details from the first step', () => {
    const onAboutYouPress = vi.fn();
    render(
      <MerchantSetupProgress step={1} onAboutYouPress={onAboutYouPress} />
    );

    const aboutYouButton = screen.getByRole('button', { name: 'About you' });
    expect(aboutYouButton).toBeDisabled();

    fireEvent.click(aboutYouButton);

    expect(onAboutYouPress).not.toHaveBeenCalled();
  });
});
