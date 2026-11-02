import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowSheet } from './ShipmentFlowSheet';

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

const preview = {
  waybill: '1349639588',
  linkable: true,
  match: { name: 'match', phone: 'match', destination: 'match' },
  order: { customerName: 'Audu Emmanuel', orderNumber: 'ORD-1' },
  gig: null,
} as const;

function externalWaybill(overrides: Record<string, unknown> = {}) {
  return {
    check: vi.fn(),
    error: null,
    link: vi.fn(),
    preview: null,
    reset: vi.fn(),
    setWaybill: vi.fn(),
    state: 'idle',
    waybill: '1349639588',
    ...overrides,
  } as never;
}

const base = {
  canBookGigl: true,
  canUseProvider: true,
  fulfillmentDetails: { imei: '', items: [], serialNumber: '' },
  fulfillmentItemIndex: 0,
  hasExistingFulfillment: false,
  isSubmitting: false,
  onClose: vi.fn(),
  onConfirmSelfFulfillment: vi.fn(),
  onContinueFromDetails: vi.fn(),
  onContinueFromMethod: vi.fn(),
  onFulfillmentDetailsChange: vi.fn(),
  onModeChange: vi.fn(),
  onRiderPhoneChange: vi.fn(),
  onSelectSavedRider: vi.fn(),
  onStepBack: vi.fn(),
  orderNumber: 'ORD-1',
  providerLabel: 'GIG Logistics',
  requiresFulfillment: false,
  riderPhone: '',
  savedRiders: [],
  selectedMode: 'external_waybill' as const,
  step: 'method' as const,
  visible: true,
};

describe('ShipmentFlowSheet external GIG waybill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only offers the option when the store can use GIG', () => {
    const { rerender } = render(
      <ShipmentFlowSheet {...base} selectedMode="provider" />
    );
    expect(screen.queryByText('Already booked on GIG?')).toBeNull();

    rerender(
      <ShipmentFlowSheet
        {...base}
        externalWaybill={externalWaybill()}
        selectedMode="provider"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Already booked on GIG\?/ })
    );
    expect(base.onModeChange).toHaveBeenCalledWith('external_waybill');
  });

  it('checks the waybill with GIG before offering to attach it', () => {
    const state = externalWaybill();
    render(<ShipmentFlowSheet {...base} externalWaybill={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check Waybill' }));

    expect((state as { check: () => void }).check).toHaveBeenCalledTimes(1);
    expect(base.onContinueFromMethod).not.toHaveBeenCalled();
  });

  it('attaches a matching waybill instead of booking a new shipment', () => {
    const state = externalWaybill({ preview, state: 'preview' });
    render(<ShipmentFlowSheet {...base} externalWaybill={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'Attach Waybill' }));

    expect((state as { link: () => void }).link).toHaveBeenCalledTimes(1);
    expect(base.onContinueFromMethod).not.toHaveBeenCalled();
  });

  it('blocks attaching a waybill that does not match the order', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        externalWaybill={externalWaybill({
          preview: { ...preview, linkable: false },
          state: 'preview',
        })}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Check Waybill' })
    ).toBeDisabled();
  });

  it('keeps the sheet open while GIG is being checked', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        externalWaybill={externalWaybill({ state: 'checking' })}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Cancel shipment flow' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Check Waybill' })
    ).toBeDisabled();
  });
});
