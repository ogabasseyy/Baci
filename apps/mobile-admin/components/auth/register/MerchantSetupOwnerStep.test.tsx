import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { MerchantSetupOwnerStep } from './MerchantSetupOwnerStep';

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
  TextInput: ({
    accessibilityLabel,
    onChangeText,
    value,
  }: {
    accessibilityLabel?: string;
    onChangeText?: (value: string) => void;
    value?: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      onChange={(event) => onChangeText?.(event.target.value)}
      value={value}
    />
  ),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/CountryPickerModal', () => ({
  CountryPickerModal: ({
    onSelect,
    visible,
  }: {
    onSelect: (country: { code: string }) => void;
    visible: boolean;
  }) =>
    visible ? (
      <>
        <button onClick={() => onSelect({ code: 'GH' })} type="button">
          Ghana
        </button>
        <button onClick={() => onSelect({ code: 'XX' })} type="button">
          Unknown
        </button>
      </>
    ) : null,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#ddd',
      inputBg: '#fff',
      text: '#111',
      textMuted: '#666',
    },
  }),
}));
vi.mock('./PersonNameFields', () => ({ PersonNameFields: () => null }));

const baseProps = {
  country: 'NG',
  firstName: 'Ada',
  lastName: 'Lovelace',
  onContinue: vi.fn(),
  onCountryChange: vi.fn(),
  onFirstNameChange: vi.fn(),
  onLastNameChange: vi.fn(),
  onPhoneChange: vi.fn(),
  phone: '+2348012345678',
};

it('hides name fields when the account already has owner names', () => {
  render(<MerchantSetupOwnerStep {...baseProps} showNameFields={false} />);

  expect(screen.getByText('Your location')).toBeInTheDocument();
  expect(screen.getByText('Phone Number (Optional)')).toBeInTheDocument();
  expect(screen.getByLabelText('Phone Number (Optional)')).toHaveValue(
    '8012345678'
  );
  expect(screen.queryByText('Owner Details')).not.toBeInTheDocument();
});

it('shows country on owner details and a flag-aware phone field', () => {
  render(<MerchantSetupOwnerStep {...baseProps} />);

  expect(screen.getByText('Country / Region')).toBeInTheDocument();
  expect(screen.getAllByText('🇳🇬')).toHaveLength(2);
  expect(screen.getByText('+234')).toBeInTheDocument();
  expect(screen.getByText('Phone Number')).toBeInTheDocument();
  expect(screen.queryByText(/Optional/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Phone Number')).toHaveValue('8012345678');
});

it('uses one country selection for the setup country and phone prefix', () => {
  const onCountryChange = vi.fn();
  const onPhoneChange = vi.fn();
  render(
    <MerchantSetupOwnerStep
      {...baseProps}
      onCountryChange={onCountryChange}
      onPhoneChange={onPhoneChange}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Country / Region, Nigeria' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ghana' }));

  expect(onCountryChange).toHaveBeenCalledWith('GH');
  expect(onPhoneChange).toHaveBeenCalledWith('+2338012345678');
});

it('falls back safely and ignores countries outside the merchant catalog', () => {
  const onCountryChange = vi.fn();
  const onPhoneChange = vi.fn();
  render(
    <MerchantSetupOwnerStep
      {...baseProps}
      country="XX"
      onCountryChange={onCountryChange}
      onPhoneChange={onPhoneChange}
    />
  );

  expect(screen.getByText('+234')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Country / Region, Nigeria' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Unknown' }));
  expect(onCountryChange).not.toHaveBeenCalled();
  expect(onPhoneChange).not.toHaveBeenCalled();
});
