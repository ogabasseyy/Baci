import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { InventoryOfferAssignment } from './InventoryOfferAssignment';

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel: string;
      accessibilityState?: { checked?: boolean };
      children: React.ReactNode;
      disabled?: boolean;
      onPress: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          'aria-checked': accessibilityState?.checked,
          disabled,
          onClick: onPress,
          role: 'radio',
          type: 'button',
        },
        children
      ),
    Text: ({ children }: { children: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});
const colors = {
  border: '#ccc',
  primary: '#00f',
  text: '#111',
  textSecondary: '#555',
} as ThemeColors;
const offers = [
  { id: 'used-1', condition: 'used' as const, status: 'active' as const },
  { id: 'new-1', condition: 'new' as const, status: 'inactive' as const },
];
describe('InventoryOfferAssignment', () => {
  it('shows the current condition and allows assigning or clearing it', () => {
    const onAssign = vi.fn();
    render(
      <InventoryOfferAssignment
        colors={colors}
        offers={offers}
        offerId="used-1"
        disabled={false}
        onAssign={onAssign}
      />
    );
    expect(
      screen.getByRole('radio', { name: 'Assign used condition' })
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(
      screen.getByRole('radio', { name: 'Assign new condition (inactive)' })
    );
    fireEvent.click(
      screen.getByRole('radio', { name: 'Clear condition assignment' })
    );
    expect(onAssign).toHaveBeenNthCalledWith(1, 'new-1');
    expect(onAssign).toHaveBeenNthCalledWith(2, null);
  });
  it('does not allow changing a reserved unit', () => {
    render(
      <InventoryOfferAssignment
        colors={colors}
        offers={offers}
        offerId="used-1"
        disabled
        onAssign={vi.fn()}
      />
    );
    expect(
      screen.getByRole('radio', { name: 'Assign new condition (inactive)' })
    ).toBeDisabled();
  });
});
