import '@testing-library/jest-dom/vitest';
import type { Order } from '@baci/shared';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrderDetailsShipmentActions } from '@/hooks/createOrderDetailsShipmentActions';
import { handleOrderDetailsProviderBookingError } from '@/hooks/handleOrderDetailsProviderBookingError';
import { OrderStatusUpdateError } from '@/hooks/orders/order-status-update-error';
import { canUseSelectedShippingProvider } from '@/lib/order-shipment';
import { ShipmentFlowSheet } from './ShipmentFlowSheet';

const state = vi.hoisted(() => ({
  userId: 'owner',
  busy: false,
  confirmed: false,
  preview: vi.fn(),
  confirm: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: state.userId } }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant', user_id: 'owner' } }),
}));
vi.mock('@/hooks/orders/useCheckoutShippingRecovery', () => ({
  useCheckoutShippingRecovery: () => ({
    draft: {
      address: 'Saved street',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: '',
      phone: '08012345678',
      latitude: '',
      longitude: '',
    },
    busy: state.busy,
    confirmed: state.confirmed,
    preview: null,
    error: null,
    requestPreview: state.preview,
    confirm: state.confirm,
    update: state.update,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#555',
      primary: '#00f',
      border: '#ddd',
      card: '#fff',
      textOnPrimary: '#fff',
      backgroundLight: '#eee',
    },
  }),
}));
vi.mock('react-native', async () => ({
  ...(await vi.importActual<typeof import('react-native')>('react-native')),
  Alert: { alert: vi.fn() },
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <section>{children}</section> : null,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: () => false,
}));
vi.mock('@/components/ui/KeyboardAwareModalContainer', () => ({
  KeyboardAwareModalContainer: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('./ShipmentIdentifierScanner', () => ({
  ShipmentIdentifierScanner: () => null,
}));
vi.mock('./CheckoutRecoveryAddressInput', () => ({
  CheckoutRecoveryAddressInput: () => null,
}));

vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://synthetic.invalid' }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const order = {
  id: 'order',
  merchant_id: 'merchant',
  payment_status: 'paid',
  shipping_status: 'processing',
  shipping_provider: 'GIGL',
  shipping_funding_source: 'customer_checkout',
  selected_quote_id: null,
  shipping_address: null,
} as Order;
const actions = {
  onClose: vi.fn(),
  onContinueFromDetails: vi.fn(),
  onContinueFromMethod: vi.fn(),
  onConfirmSelfFulfillment: vi.fn(),
  onFulfillmentDetailsChange: vi.fn(),
  onModeChange: vi.fn(),
  onRiderPhoneChange: vi.fn(),
  onSelectSavedRider: vi.fn(),
  onStepBack: vi.fn(),
};
const props = {
  ...actions,
  recoveryOrder: order,
  canUseProvider: canUseSelectedShippingProvider(order),
  fulfillmentDetails: { imei: '', serialNumber: '', items: [] },
  fulfillmentItemIndex: 0,
  hasExistingFulfillment: false,
  isSubmitting: false,
  providerLabel: 'GIG Logistics',
  orderNumber: 'ORD-TEST',
  requiresFulfillment: true,
  riderPhone: '',
  savedRiders: [],
  selectedMode: 'self_fulfillment' as const,
  step: 'method' as const,
  visible: true,
};
type GiglShipping = NonNullable<
  ComponentProps<typeof ShipmentFlowSheet>['giglShipping']
>;
const recoveryLabel = 'Confirm destination and refresh paid quote';

describe('ShipmentFlowSheet prepaid recovery reachability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userId = 'owner';
    state.busy = false;
    state.confirmed = false;
  });
  it('books with a saved checkout selection without opening destination recovery', () => {
    render(
      <ShipmentFlowSheet
        {...props}
        recoveryOrder={{ ...order, selected_quote_id: 'saved-quote' }}
        canUseProvider
        selectedMode="provider"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    );
    expect(actions.onContinueFromMethod).toHaveBeenCalledOnce();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it.each([
    'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
    'SHIPPING_QUOTE_RECEIVER_MISMATCH',
    'SHIPPING_QUOTE_ITEMS_MISMATCH',
  ])('opens required recovery after %s and keeps Book blocked through cancel/reopen', async (code) => {
    const updateStatus = vi
      .fn()
      .mockRejectedValue(
        new OrderStatusUpdateError('Review saved shipping quote', code)
      );
    const shipmentActions = createOrderDetailsShipmentActions({
      fulfillmentDetails: props.fulfillmentDetails,
      fulfillmentItemIndex: 0,
      fulfillmentItems: [],
      handleSaveRider: vi.fn(),
      merchantId: 'merchant',
      order: order as never,
      pendingShipmentMode: 'provider',
      providerBookingAvailable: true,
      providerLabel: 'GIG Logistics',
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      requiresShipmentDetails: false,
      riderPhone: '',
      setFulfillmentDetails: vi.fn(),
      setFulfillmentItemIndex: vi.fn(),
      setIsShipmentSubmitting: vi.fn(),
      setPendingShipmentMode: vi.fn(),
      setRiderPhone: vi.fn(),
      setShipmentFlowStep: vi.fn(),
      setShowShipmentFlow: vi.fn(),
      setShowStatusModal: vi.fn(),
      setSuccessModal: vi.fn(),
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
      updateStatus,
      onProviderBookingError: (error) =>
        handleOrderDetailsProviderBookingError(error, undefined, true),
    });
    const booking = vi.fn(shipmentActions.proceedFromShipmentMethod);
    const saved = {
      ...props,
      recoveryOrder: { ...order, selected_quote_id: 'saved-quote' },
      canUseProvider: true,
      selectedMode: 'provider' as const,
      onContinueFromMethod: booking,
    };
    const { rerender } = render(<ShipmentFlowSheet {...saved} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Preview new shipping quote' })
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeDisabled();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(booking).toHaveBeenCalledOnce();
    expect(updateStatus).toHaveBeenCalledOnce();
    rerender(<ShipmentFlowSheet {...saved} visible={false} />);
    rerender(<ShipmentFlowSheet {...saved} visible />);
    expect(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeDisabled();
    const continueSelf = vi.fn();
    rerender(
      <ShipmentFlowSheet
        {...saved}
        selectedMode="self_fulfillment"
        onContinueFromMethod={continueSelf}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Continue to Rider' })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Rider' }));
    expect(continueSelf).toHaveBeenCalledOnce();
    expect(updateStatus).toHaveBeenCalledOnce();
    rerender(<ShipmentFlowSheet {...saved} />);
    expect(
      screen.getByRole('button', { name: 'Book with GIG Logistics' })
    ).toBeDisabled();
    state.confirmed = true;
    rerender(<ShipmentFlowSheet {...saved} visible />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Book with GIG Logistics' })
      ).toBeEnabled()
    );
    expect(booking).toHaveBeenCalledOnce();
  });
  it('allows recovery when the old quote is deleted and the eligibility wallet panel is absent', () => {
    render(<ShipmentFlowSheet {...props} giglShipping={undefined} />);
    expect(props.canUseProvider).toBe(false);
    expect(
      screen.getByRole('radio', { name: /^Use GIG Logistics/ })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('button', { name: 'Continue to Rider' })
    ).toBeEnabled();
    expect(screen.queryByText('Ship with GIG')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: recoveryLabel }));
    expect(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    ).toBeEnabled();
    expect(
      screen.getByRole('radio', { name: /^Use GIG Logistics/ })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Continue to Rider' })
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    );
    expect(state.preview).toHaveBeenCalledOnce();
    expect(actions.onContinueFromMethod).not.toHaveBeenCalled();
    expect(actions.onModeChange).not.toHaveBeenCalled();
  });
  it('preserves owner and paid checkout eligibility when recovery is exposed outside provider mode', () => {
    state.userId = 'staff';
    const { rerender } = render(<ShipmentFlowSheet {...props} />);
    expect(
      screen.queryByRole('button', { name: recoveryLabel })
    ).not.toBeInTheDocument();
    state.userId = 'owner';
    rerender(
      <ShipmentFlowSheet
        {...props}
        recoveryOrder={{ ...order, payment_status: 'pending' }}
      />
    );
    expect(
      screen.queryByRole('button', { name: recoveryLabel })
    ).not.toBeInTheDocument();
  });
  it('blocks self-fulfillment, mode changes, back and dismissal while recovery is busy', () => {
    const { rerender } = render(
      <ShipmentFlowSheet {...props} canUseProvider />
    );
    fireEvent.click(screen.getByRole('button', { name: recoveryLabel }));
    state.busy = true;
    rerender(<ShipmentFlowSheet {...props} canUseProvider />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Rider' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Use GIG Logistics/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Close shipment flow' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel shipment flow' })
    );
    expect(actions.onContinueFromMethod).not.toHaveBeenCalled();
    expect(actions.onModeChange).not.toHaveBeenCalled();
    expect(actions.onStepBack).not.toHaveBeenCalled();
    expect(actions.onClose).not.toHaveBeenCalled();
  });
  it('also blocks the wallet-panel provider selector while recovery is busy', () => {
    const giglShipping = {
      addressDraft: {},
      error: null,
      fundingAccount: null,
      missingFields: [],
      quote: null,
      state: 'idle',
      wallet: null,
      ensureFreshQuoteForConfirmation: vi
        .fn<GiglShipping['ensureFreshQuoteForConfirmation']>()
        .mockResolvedValue(false),
      refreshBalance: vi
        .fn<GiglShipping['refreshBalance']>()
        .mockResolvedValue(null),
      refreshFundingAccount: vi
        .fn<GiglShipping['refreshFundingAccount']>()
        .mockResolvedValue(null),
      requestQuote: vi
        .fn<GiglShipping['requestQuote']>()
        .mockResolvedValue(null),
      reset: vi.fn<GiglShipping['reset']>(),
      startFunding: vi
        .fn<GiglShipping['startFunding']>()
        .mockResolvedValue(undefined),
      startTransferPoll: vi.fn<GiglShipping['startTransferPoll']>(),
      updateAddressField: vi.fn<GiglShipping['updateAddressField']>(),
    } satisfies GiglShipping;
    const { rerender } = render(
      <ShipmentFlowSheet
        {...props}
        selectedMode="provider"
        giglShipping={giglShipping}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: recoveryLabel }));
    state.busy = true;
    rerender(
      <ShipmentFlowSheet
        {...props}
        selectedMode="provider"
        giglShipping={giglShipping}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Ship with GIG/ }));
    expect(actions.onModeChange).not.toHaveBeenCalled();
  });
  it('does not enable provider booking or select a mode when recovery finishes', () => {
    const { rerender } = render(<ShipmentFlowSheet {...props} />);
    fireEvent.click(screen.getByRole('button', { name: recoveryLabel }));
    state.confirmed = true;
    rerender(<ShipmentFlowSheet {...props} />);
    expect(
      screen.getByText(/Use Book with GIG Logistics separately/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /^Use GIG Logistics/ })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('button', { name: 'Continue to Rider' })
    ).toBeEnabled();
    expect(actions.onContinueFromMethod).not.toHaveBeenCalled();
    expect(actions.onModeChange).not.toHaveBeenCalled();
  });
});
