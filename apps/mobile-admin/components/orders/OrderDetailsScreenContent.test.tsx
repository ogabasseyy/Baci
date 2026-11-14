import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { router } from 'expo-router';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { useOrderDetailsController } from '@/hooks/useOrderDetailsController';
import { OrderDetailsScreenContent } from './OrderDetailsScreenContent';

const auditTrailCardMock = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
  router: {
    push: vi.fn(),
  },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerRight?: () => React.ReactNode };
    }) => options?.headerRight?.() ?? null,
  },
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

// OrderDetailsScreenContent reads the merchant for VAT-breakdown display.
// Mock it so the real hook's native import graph never loads under vitest.
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: null }),
}));

vi.mock('react-native', async () =>
  (await import('./OrderDetailsScreenContent.test-support')).reactNativeMock()
);

vi.mock('@/components/orders/OrderItemDetailModal', () => ({
  OrderItemDetailModal: () => null,
}));
vi.mock('@/components/orders/OrderPaymentOptionDialog', () => ({
  OrderPaymentOptionDialog: () => null,
}));
vi.mock('@/components/orders/OrderStatusSheet', () => ({
  OrderStatusSheet: () => null,
}));
vi.mock('@/components/orders/RecordPaymentSheet', () => ({
  RecordPaymentSheet: () => null,
}));
vi.mock('@/components/orders/ShipmentFlowSheet', () => ({
  ShipmentFlowSheet: () => null,
}));
vi.mock('@/hooks/useOrderDetailsGiglExternalWaybill', () => ({
  useOrderDetailsGiglExternalWaybill: () => undefined,
}));
vi.mock('@/components/orders/ShipOnCreditDialog', () => ({
  ShipOnCreditDialog: () => null,
}));
vi.mock('@/components/ui/ReceiptPreviewModal', () => ({
  ReceiptPreviewModal: () => null,
}));
vi.mock('@/components/ui/SuccessModal', () => ({
  SuccessModal: () => null,
}));
vi.mock('./OrderDetailsFooterBar', () => ({
  OrderDetailsFooterBar: () => null,
}));
vi.mock('./OrderDetailsItemsAndPaymentSection', () => ({
  OrderDetailsItemsAndPaymentSection: () => null,
}));
vi.mock('./OrderDetailsOverviewSection', () => ({
  OrderDetailsOverviewSection: () => null,
}));
vi.mock('./OrderDetailsShippingSection', () => ({
  OrderDetailsShippingSection: () => null,
}));
vi.mock('./OrderAuditTrailCard', () => ({
  OrderAuditTrailCard: (props: unknown) => {
    auditTrailCardMock(props);
    return <div>audit-card</div>;
  },
}));

function createController(
  overrides: Partial<ReturnType<typeof useOrderDetailsController>> = {}
) {
  return {
    closeShipmentFlow: vi.fn(),
    colors: {
      background: '#ffffff',
      border: '#e2e8f0',
      card: '#ffffff',
      primary: '#2563eb',
      text: '#0f172a',
      textMuted: '#94a3b8',
      textSecondary: '#64748b',
    },
    creditNotes: '',
    currencySymbol: '₦',
    formatAddress: vi.fn(() => 'Address'),
    formatDate: vi.fn(() => 'Today'),
    formatPrice: vi.fn((amount: number) => `₦${amount}`),
    fulfillmentDetails: { imei: '', items: [], serialNumber: '' },
    fulfillmentItemIndex: 0,
    handleCall: vi.fn(),
    handleEmail: vi.fn(),
    handlePaymentAmountChange: vi.fn(),
    handleRecordPayment: vi.fn(),
    handleSendOrderDetailsToRider: vi.fn(),
    handleSendReceipt: vi.fn(),
    handleSendReminder: vi.fn(),
    handleSendRiderToCustomer: vi.fn(),
    handleShare: vi.fn(),
    handleShareReceiptPdf: vi.fn(),
    handleShipOnCredit: vi.fn(),
    handleShipmentFlowBack: vi.fn(),
    handleStatusUpdate: vi.fn(),
    handleSubmitSelfFulfillment: vi.fn(),
    handleWhatsApp: vi.fn(),
    isGeneratingReceipt: false,
    isAuditEventsError: false,
    isAuditEventsLoading: false,
    isShipmentSubmitting: false,
    order: {
      amount_paid: 0,
      balance: 10000,
      created_at: '2024-01-01T00:00:00.000Z',
      customer_email: 'customer@example.com',
      customer_name: 'Ada',
      customer_phone: '08030000000',
      discount_amount: 0,
      id: 'order-1',
      items: [],
      order_number: 'ORD-1',
      payment_status: 'pending',
      shipping_address: null,
      shipping_status: 'pending',
      total: 10000,
      updated_at: '2024-01-01T00:00:00.000Z',
    },
    auditEvents: [],
    paymentAmount: '',
    paymentColor: '#ca8a04',
    paymentConfig: { label: 'Awaiting Payment' },
    paymentMethod: '',
    paymentNotes: '',
    pendingShipmentMode: 'self_fulfillment',
    proceedFromFulfillmentDetails: vi.fn(),
    proceedFromShipmentMethod: vi.fn(),
    providerBookingAvailable: false,
    providerLabel: null,
    receiptHtml: '',
    recordPaymentMutation: { isPending: false },
    requiresShipmentDetails: false,
    riderPhone: '',
    savedRiders: [],
    selectedOrderItem: null,
    setCreditNotes: vi.fn(),
    setFulfillmentDetails: vi.fn(),
    setFulfillmentItemIndex: vi.fn(),
    updateFulfillmentDetails: vi.fn(),
    setPaymentAmount: vi.fn(),
    setPaymentMethod: vi.fn(),
    setPaymentNotes: vi.fn(),
    setPendingShipmentMode: vi.fn(),
    setRiderPhone: vi.fn(),
    setSelectedOrderItem: vi.fn(),
    setShipmentFlowStep: vi.fn(),
    setShowCreditModal: vi.fn(),
    setShowPaymentOptionModal: vi.fn(),
    setShowReceiptPreview: vi.fn(),
    setShowRecordPaymentModal: vi.fn(),
    setShowShipmentFlow: vi.fn(),
    setShowStatusModal: vi.fn(),
    setSuccessModal: vi.fn(),
    shipmentFlowStep: 'details',
    shipOnCreditMutation: { isPending: false },
    shippingColor: '#2563eb',
    shippingConfig: { icon: 'receipt-outline', label: 'Unfulfilled' },
    showCreditModal: false,
    showPaymentOptionModal: false,
    showPostShipmentActions: false,
    showReceiptPreview: false,
    showRecordPaymentModal: false,
    showShipmentFlow: false,
    showStatusModal: false,
    sourceInfo: { color: '#2563eb', label: 'Manual', name: 'manual' },
    successModal: {
      actionLabel: '',
      actionVariant: 'default',
      message: '',
      showAction: false,
      subMessage: '',
      title: '',
      visible: false,
    },
    ...overrides,
  } as unknown as ReturnType<typeof useOrderDetailsController>;
}

describe('OrderDetailsScreenContent', () => {
  it('navigates to order edit and renders header share plus audit actions', () => {
    render(<OrderDetailsScreenContent controller={createController()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit order' }));

    expect(router.push).toHaveBeenCalledWith('/order/edit?id=order-1');
    expect(
      screen.getByRole('button', { name: 'Share order' })
    ).toBeInTheDocument();
    expect(screen.getByText('audit-card')).toBeInTheDocument();
  });

  it('passes audit error state to the audit trail card', () => {
    render(
      <OrderDetailsScreenContent
        controller={createController({ isAuditEventsError: true })}
      />
    );

    expect(auditTrailCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ isError: true })
    );
  });

  it('hides the edit action for terminal orders', () => {
    const controller = createController();
    if (controller.order) {
      controller.order.shipping_status = 'cancelled';
    }

    render(<OrderDetailsScreenContent controller={controller} />);

    expect(
      screen.queryByRole('button', { name: 'Edit order' })
    ).not.toBeInTheDocument();
  });

  it('hides the order screen content from accessibility while the status drawer is open', () => {
    render(
      <OrderDetailsScreenContent
        controller={createController({ showStatusModal: true })}
      />
    );

    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-accessibility-elements-hidden',
      'true'
    );
    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-important-for-accessibility',
      'no-hide-descendants'
    );
  });

  it('keeps the order screen content accessible by default', () => {
    render(<OrderDetailsScreenContent controller={createController()} />);

    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-accessibility-elements-hidden',
      'false'
    );
    expect(screen.getByTestId('order-details-main-content')).toHaveAttribute(
      'data-important-for-accessibility',
      'auto'
    );
  });
});
