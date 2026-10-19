import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NewCustomerManualAddressFallback } from './NewCustomerManualAddressFallback';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('@gorhom/bottom-sheet', async () => {
  const React = await import('react');
  return {
    BottomSheetTextInput: ({
      accessibilityLabel,
      onChangeText,
      placeholder,
      value,
    }: {
      accessibilityLabel?: string;
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value: value ?? '',
      }),
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

describe('NewCustomerManualAddressFallback', () => {
  it('renders address, city, and state inputs', () => {
    const onAddressChange = vi.fn();
    const setNewCustomer = vi.fn();

    render(
      <NewCustomerManualAddressFallback
        address="12 Marina"
        city="Lagos"
        colors={LIGHT_COLORS}
        onAddressChange={onAddressChange}
        setNewCustomer={setNewCustomer}
        state="Lagos State"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Enter address'), {
      target: { value: '14 Bode Thomas' },
    });
    fireEvent.change(screen.getByPlaceholderText('City'), {
      target: { value: 'Ikeja' },
    });
    fireEvent.change(screen.getByPlaceholderText('State'), {
      target: { value: 'Lagos' },
    });

    expect(onAddressChange).toHaveBeenCalledWith('14 Bode Thomas');
    expect(setNewCustomer).toHaveBeenCalledTimes(2);
  });
});
