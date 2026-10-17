import '@testing-library/jest-dom/vitest';
import type { Order } from '@baci/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
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
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/checkout-shipping-recovery', () => ({
  requestCheckoutShippingRecovery: api,
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
it('requires a fresh preview and unchecked consent after a second saved-quote rejection', async () => {
  api
    .mockResolvedValueOnce({
      previewId: 'preview-1',
      canConfirm: true,
      paidShippingFee: 100,
      quote: {
        id: 'quote-1',
        price: 100,
        displayName: 'GIG',
        estimatedDays: 2,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    })
    .mockResolvedValueOnce({ confirmed: true, quoteId: 'quote-1' })
    .mockResolvedValueOnce({
      previewId: 'preview-2',
      canConfirm: true,
      paidShippingFee: 100,
      quote: {
        id: 'quote-2',
        price: 100,
        displayName: 'GIG',
        estimatedDays: 2,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    });
  const booking = vi.fn().mockResolvedValue('review_checkout_quote');
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShipmentFlowSheet
        {...props}
        recoveryOrder={{ ...order, selected_quote_id: 'saved' }}
        canUseProvider
        selectedMode="provider"
        onContinueFromMethod={booking}
      />
    </QueryClientProvider>
  );
  const book = () =>
    screen.getByRole('button', { name: 'Book with GIG Logistics' });
  fireEvent.click(book());
  await screen.findByRole('button', { name: 'Preview new shipping quote' });
  const fill = () => {
    for (const [field, value] of Object.entries({
      address: 'Street',
      city: 'Ikeja',
      state: 'Lagos',
      phone: '08012345678',
      latitude: '6.5',
      longitude: '3.3',
    }))
      fireEvent.change(screen.getByLabelText(`Recovery ${field}`), {
        target: { value },
      });
  };
  fill();
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview new shipping quote' })
  );
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Save confirmed destination and quote' })
  );
  await waitFor(() => expect(book()).toBeEnabled());
  expect(api).toHaveBeenCalledTimes(2);
  fireEvent.click(book());
  await waitFor(() => expect(book()).toBeDisabled());
  expect(
    screen.queryByText(/Destination and quote saved/)
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Recovery latitude')).toHaveValue('');
  expect(screen.getByLabelText('Recovery longitude')).toHaveValue('');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(2);
  expect(booking).toHaveBeenCalledTimes(2);
  fill();
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview new shipping quote' })
  );
  expect(await screen.findByRole('checkbox')).toHaveTextContent(
    '☐ I confirmed this destination and pin with the customer.'
  );
  expect(
    screen.getByRole('button', { name: 'Save confirmed destination and quote' })
  ).toBeDisabled();
  expect(api).toHaveBeenCalledTimes(3);
  expect(booking).toHaveBeenCalledTimes(2);
});
