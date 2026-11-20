import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { readOxygenOrderPlan } from '@/lib/oxygen-order-plan';
import { OrderDetailsScreen } from './OrderDetailsScreen';
import type { OrderDetails } from './OrderDetailsScreen.types';
import { useOrderDetailsController } from './use-order-details-controller';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/components/receipts/ReceiptPreviewModal', () => ({
  ReceiptPreviewModal: () => null,
}));
jest.mock('./use-order-details-controller', () => ({
  useOrderDetailsController: jest.fn(),
}));
jest.mock('@/lib/oxygen-order-plan', () => ({
  readOxygenOrderPlan: jest.fn(),
}));

const readPlan = jest.mocked(readOxygenOrderPlan);
const getController = jest.mocked(useOrderDetailsController);
const order: OrderDetails = {
  id: 'order-1',
  order_number: 'ORD-1',
  shipping_status: 'delivered',
  subtotal: 80000,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  total: 80000,
  payment_method: 'oxygen',
  payment_status: 'paid',
  created_at: '2026-11-19T12:00:00Z',
  updated_at: '2026-11-19T12:00:00Z',
  shipping_address: { name: '', phone: '', address: '', city: '', state: '' },
  items: [],
};
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

function showOrder(paymentMethod: string, userId: string | undefined) {
  getController.mockReturnValue({
    order: { ...order, payment_method: paymentMethod },
    userId,
    canCancel: false,
    error: null,
    handleCallRider: jest.fn(),
    handleCancelOrder: jest.fn(),
    handleContactSupport: jest.fn(),
    handleGoBack: jest.fn(),
    handleLeaveGoogleReview: jest.fn(),
    handleOpenProduct: jest.fn(),
    handleOpenReceipt: jest.fn(),
    handleReturnOrder: jest.fn(),
    handleTrackOrder: jest.fn(),
    insurancePolicy: null,
    isCancelling: false,
    isLoading: false,
    merchantInfo: undefined,
    receiptPreview: {
      isLoading: false,
      isOpen: false,
      html: '',
      isPaid: false,
      documentKind: 'invoice',
      openPreview: jest.fn(),
      openPreviewByOrderId: jest.fn(),
      closePreview: jest.fn(),
    },
  });
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <OrderDetailsScreen />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  readPlan.mockReset();
});

it('shows and reads the current signed-in customer’s Oxygen order plan', async () => {
  readPlan.mockResolvedValue({
    upfront: 20000,
    upfrontConfirmed: true,
    activationConfirmed: true,
    months: 3,
    schedule: [{ period: 1, dueDate: [2026, 11, 27], amount: 20000 }],
  });
  showOrder('oxygen', 'customer-1');
  expect(await screen.findByText('Oxygen payment plan')).toBeVisible();
  expect(readPlan).toHaveBeenCalledWith(
    'order-1',
    'customer-1',
    expect.anything()
  );
});

it.each([
  ['paystack', 'customer-1'],
  ['oxygen', undefined],
])('does not read or render an inapplicable plan (%s, %s)', (method, userId) => {
  showOrder(method, userId);
  expect(screen.getByText('Order Summary')).toBeVisible();
  expect(screen.queryByText('Oxygen payment plan')).toBeNull();
  expect(readPlan).not.toHaveBeenCalled();
});
