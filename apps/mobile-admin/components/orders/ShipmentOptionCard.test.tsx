import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { COLORS, type ThemeColors } from '@/constants/theme';
import { ShipmentOptionCard } from './ShipmentOptionCard';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ name }: { name: string }) => (
    <span aria-label={name} role="img" />
  ),
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : ((style as Record<string, unknown> | null) ?? {});

  return {
    StyleSheet: { create: (styles: unknown) => styles },
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityState?: { checked?: boolean; disabled?: boolean };
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-checked': accessibilityState?.checked,
          'aria-label': accessibilityLabel,
          disabled,
          onClick: onPress,
          role: 'radio',
          type: 'button',
        },
        children
      ),
    Text: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) =>
      React.createElement(
        'span',
        { 'data-color': flatten(style).color },
        children
      ),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

const colors: ThemeColors = COLORS;

function renderCard(
  props: Partial<React.ComponentProps<typeof ShipmentOptionCard>> = {}
) {
  const onPress = vi.fn();
  render(
    <ShipmentOptionCard
      colors={colors}
      description="GIG Logistics · 2 days"
      icon="paper-plane-outline"
      onPress={onPress}
      selected={false}
      title="Ship with GIG"
      {...props}
    />
  );
  return { onPress };
}

describe('ShipmentOptionCard', () => {
  it('renders only the title and description when no price or details are given', () => {
    renderCard();

    expect(
      screen.getByRole('radio', {
        name: 'Ship with GIG. GIG Logistics · 2 days',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText('₦48,500')).not.toBeInTheDocument();
  });

  it('shows the price and detail lines and reads them in the accessibility label', () => {
    renderCard({
      details: [{ text: 'Wallet balance: ₦60,000' }],
      price: '₦48,500',
    });

    expect(screen.getByText('₦48,500')).toBeInTheDocument();
    expect(screen.getByText('Wallet balance: ₦60,000')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', {
        name: 'Ship with GIG. GIG Logistics · 2 days. ₦48,500. Wallet balance: ₦60,000',
      })
    ).toBeInTheDocument();
  });

  it('colours warning details with the warning colour and others as secondary text', () => {
    renderCard({
      details: [
        { text: 'Wallet balance: ₦10,000' },
        { text: 'Top up ₦38,500 to book', tone: 'warning' },
      ],
      price: '₦48,500',
    });

    expect(screen.getByText('Top up ₦38,500 to book')).toHaveAttribute(
      'data-color',
      colors.warning
    );
    expect(screen.getByText('Wallet balance: ₦10,000')).toHaveAttribute(
      'data-color',
      colors.textSecondary
    );
  });

  it('reports the selected state and calls onPress when tapped', () => {
    const { onPress } = renderCard({ selected: true });

    const card = screen.getByRole('radio', { name: /Ship with GIG/ });
    expect(card).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(card);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('does not call onPress while disabled', () => {
    const { onPress } = renderCard({ disabled: true });

    const card = screen.getByRole('radio', { name: /Ship with GIG/ });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onPress).not.toHaveBeenCalled();
  });
});
