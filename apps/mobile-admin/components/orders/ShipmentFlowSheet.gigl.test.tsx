import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowSheet } from './ShipmentFlowSheet';

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

const quote = {
  id: 'b2152ea0-831d-4387-b4c1-5dcf29a74c54',
  provider: 'GIGL' as const,
  serviceTier: 'Express',
  carrierName: 'GIG Logistics',
  displayName: 'Door Delivery',
  estimatedDays: 2,
  price: 11000,
  currency: 'NGN' as const,
  pickupIncluded: true,
  insuranceIncluded: false,
  expiresAt: '2026-09-01T18:00:00.000Z',
};

function gigl(canBook: boolean, error: string | null = null) {
  return {
    addressDraft: {},
    error,
    ensureFreshQuoteForConfirmation: vi.fn().mockResolvedValue(true),
    fundingAccount: null,
    missingFields: [],
    quote,
    refreshBalance: vi.fn(),
    requestQuote: vi.fn(),
    reset: vi.fn(),
    startFunding: vi.fn(),
    startTransferPoll: vi.fn(),
    state: error ? ('error' as const) : ('ready' as const),
    updateAddressField: vi.fn(),
    wallet: {
      availableBalance: canBook ? 11000 : 1000,
      canBook,
      shortfall: canBook ? 0 : 10000,
    },
  } as never;
}

const base = {
  canUseProvider: false,
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
  providerLabel: null,
  requiresFulfillment: false,
  riderPhone: '',
  savedRiders: [],
  selectedMode: 'provider' as const,
  step: 'method' as const,
  visible: true,
};

describe('ShipmentFlowSheet manual-order GIG flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows fresh GIG quote and keeps explicit booking disabled until funded', async () => {
    const { rerender } = render(
      <ShipmentFlowSheet {...base} giglShipping={gigl(false)} />
    );
    expect(screen.getByText('Ship with GIG')).toBeInTheDocument();
    expect(screen.getByText('₦11,000')).toBeInTheDocument();
    expect(screen.getByText('Self Fulfill')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeDisabled();

    rerender(<ShipmentFlowSheet {...base} giglShipping={gigl(true)} />);
    const confirm = screen.getByRole('button', {
      name: 'Book with GIG Logistics',
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await vi.waitFor(() =>
      expect(base.onContinueFromMethod).toHaveBeenCalledOnce()
    );
  });

  it('preserves saved checkout provider behavior', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        canUseProvider
        giglShipping={undefined}
        providerLabel="Topship"
      />
    );
    expect(screen.getByText('Use Topship')).toBeInTheDocument();
    expect(screen.queryByText('Ship with GIG')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Book with Topship' })
    ).toBeEnabled();
  });

  it('enables Book from canUseProvider when the wallet panel is hidden', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        canUseProvider
        giglShipping={undefined}
        providerLabel="GIG Logistics"
      />
    );
    expect(screen.getByText('Use GIG Logistics')).toBeInTheDocument();
    expect(screen.queryByText('Ship with GIG')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeEnabled();
  });

  it('keeps the GIGL funding panel visible for a bound underfunded wallet quote', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        canUseProvider
        giglShipping={gigl(false)}
        providerLabel="GIG Logistics"
      />
    );
    expect(screen.getByText('Ship with GIG')).toBeInTheDocument();
    expect(screen.queryByText('Use GIG Logistics')).not.toBeInTheDocument();
  });

  it('disables Book when canUseProvider is true but the wallet is underfunded', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        canUseProvider
        giglShipping={gigl(false)}
        providerLabel="GIG Logistics"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeDisabled();
  });

  it('blocks the stale-quote tap and requires a new tap after refresh', async () => {
    const shipping = gigl(true) as unknown as {
      ensureFreshQuoteForConfirmation: ReturnType<typeof vi.fn>;
    };
    shipping.ensureFreshQuoteForConfirmation
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<ShipmentFlowSheet {...base} giglShipping={shipping as never} />);
    const confirm = screen.getByRole('button', {
      name: 'Book with GIG Logistics',
    });

    fireEvent.click(confirm);
    await vi.waitFor(() =>
      expect(shipping.ensureFreshQuoteForConfirmation).toHaveBeenCalledOnce()
    );
    expect(base.onContinueFromMethod).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await vi.waitFor(() =>
      expect(base.onContinueFromMethod).toHaveBeenCalledOnce()
    );
  });

  it('runs quote freshness when canUseProvider is true', async () => {
    const shipping = gigl(true) as unknown as {
      ensureFreshQuoteForConfirmation: ReturnType<typeof vi.fn>;
    };
    shipping.ensureFreshQuoteForConfirmation.mockResolvedValue(true);
    render(
      <ShipmentFlowSheet
        {...base}
        canUseProvider
        giglShipping={shipping as never}
        providerLabel="GIG Logistics"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    );
    await vi.waitFor(() =>
      expect(shipping.ensureFreshQuoteForConfirmation).toHaveBeenCalledOnce()
    );
    expect(base.onContinueFromMethod).toHaveBeenCalledOnce();
  });

  it('leaves Self Fulfill available after a provider error', () => {
    render(
      <ShipmentFlowSheet
        {...base}
        giglShipping={gigl(false, 'Quote unavailable')}
      />
    );
    expect(screen.getByText('Quote unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Self Fulfill'));
    expect(base.onModeChange).toHaveBeenCalledWith('self_fulfillment');
  });
});
