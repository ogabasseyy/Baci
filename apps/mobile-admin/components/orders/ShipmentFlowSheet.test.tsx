import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowSheet } from './ShipmentFlowSheet';

const runtimeState = vi.hoisted(() => ({
  isIos: true,
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));

vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: (platform: string) =>
    platform === 'ios' ? runtimeState.isIos : false,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#0b1020',
      border: '#273044',
      card: '#18192a',
      primary: '#4f9cf9',
      text: '#ffffff',
      textOnPrimary: '#ffffff',
      textSecondary: '#a4adbd',
    },
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 8, right: 0, bottom: 34, left: 0 }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('@/components/ui/KeyboardAwareModalContainer', () => ({
  KeyboardAwareModalContainer: ({
    children,
    keyboardVerticalOffset,
  }: {
    children?: ReactNode;
    keyboardVerticalOffset?: number;
  }) => (
    <section
      data-keyboard-offset={keyboardVerticalOffset}
      data-testid="keyboard-aware-container"
    >
      {children}
    </section>
  ),
}));

vi.mock('./ShipmentIdentifierScanner', () => ({
  ShipmentIdentifierScanner: ({
    field,
    visible,
  }: {
    field: string;
    visible: boolean;
  }) =>
    visible ? (
      <div data-field={field} data-testid="identifier-scanner" />
    ) : null,
}));

vi.mock('react-native', () => {
  return {
    ActivityIndicator: () => <span aria-label="Loading" role="status" />,
    Modal: ({
      children,
      visible,
    }: {
      children?: ReactNode;
      visible?: boolean;
    }) => (visible ? <section>{children}</section> : null),
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
    ScrollView: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    StyleSheet: {
      absoluteFill: {},
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
    },
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) => (
      <input
        onChange={(event) => onChangeText?.(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    ),
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

const defaultProps = {
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
  orderNumber: 'ORD-290626-BA9E79',
  providerLabel: 'Topship',
  requiresFulfillment: true,
  riderPhone: '',
  savedRiders: [],
  selectedMode: 'self_fulfillment' as const,
  step: 'details' as const,
  visible: true,
};

describe('ShipmentFlowSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.isIos = true;
  });

  it('rests the iOS sheet on top of the keyboard instead of floating high', () => {
    render(<ShipmentFlowSheet {...defaultProps} />);

    expect(screen.getByTestId('keyboard-aware-container')).toHaveAttribute(
      'data-keyboard-offset',
      '0'
    );
  });

  it('keeps the existing Android keyboard offset', () => {
    runtimeState.isIos = false;

    render(<ShipmentFlowSheet {...defaultProps} />);

    expect(screen.getByTestId('keyboard-aware-container')).toHaveAttribute(
      'data-keyboard-offset',
      '24'
    );
  });

  it('closes when the outside cancel region is tapped', () => {
    render(<ShipmentFlowSheet {...defaultProps} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel shipment flow' })
    );

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps outside cancellation disabled while submitting', () => {
    render(<ShipmentFlowSheet {...defaultProps} isSubmitting />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel shipment flow' })
    );

    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('resets the identifier scanner when the sheet closes while still mounted', () => {
    const { rerender } = render(<ShipmentFlowSheet {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan IMEI' }));

    expect(screen.getByTestId('identifier-scanner')).toHaveAttribute(
      'data-field',
      'imei'
    );

    rerender(<ShipmentFlowSheet {...defaultProps} visible={false} />);
    rerender(<ShipmentFlowSheet {...defaultProps} visible={true} />);

    expect(screen.queryByTestId('identifier-scanner')).not.toBeInTheDocument();
  });
});
