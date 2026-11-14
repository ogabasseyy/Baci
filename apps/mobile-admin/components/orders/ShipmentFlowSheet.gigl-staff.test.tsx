import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowSheet } from './ShipmentFlowSheet';
import { base, gigl } from './ShipmentFlowSheet.gigl.test-support';

vi.mock('./ShipmentFlowSheetPresence', () => ({
  ShipmentFlowSheetPresence: ({
    accessory,
    children,
    visible,
  }: {
    accessory?: ReactNode;
    children?: ReactNode;
    visible: boolean;
  }) =>
    visible ? (
      <section>
        {children}
        {accessory}
      </section>
    ) : null,
}));

vi.mock('./CheckoutShippingRecoveryPanel', () => ({
  CheckoutShippingRecoveryPanel: () => null,
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: () => false,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#eee',
      border: '#ddd',
      card: '#fff',
      error: '#c00',
      primary: '#06f',
      primaryLight: '#def',
      text: '#111',
      textMuted: '#777',
      textOnPrimary: '#fff',
      textSecondary: '#555',
    },
  }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));
vi.mock('@/components/ui/KeyboardAwareModalContainer', () => ({
  KeyboardAwareModalContainer: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('./ShipmentIdentifierScanner', () => ({
  ShipmentIdentifierScanner: () => null,
}));
vi.mock('react-native', () => ({
  ActivityIndicator: () => <span role="status" />,
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  Modal: ({ children, visible }: { children?: ReactNode; visible: boolean }) =>
    visible ? <section>{children}</section> : null,
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
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: {
    absoluteFill: {},
    create: (value: unknown) => value,
    hairlineWidth: 1,
  },
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
      onChange={(event) => onChangeText?.(event.currentTarget.value)}
      value={value}
    />
  ),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('ShipmentFlowSheet manual-order GIG flow for staff', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows staff without GIG booking rights the price with a note and keeps Book off', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        canBookGigl={false}
        giglShipping={gigl(true)}
      />
    );

    expect(screen.getByText('₦11,000')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ask the store owner or an admin to book GIG for this order.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('Ship with GIG')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeDisabled();
    fireEvent.click(screen.getByText('Self Fulfill'));
    expect(base.onModeChange).toHaveBeenCalledWith('self_fulfillment');
  });
});
