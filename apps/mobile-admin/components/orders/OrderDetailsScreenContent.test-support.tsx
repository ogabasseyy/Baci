import React from 'react';
import { vi } from 'vitest';
import type { useOrderDetailsController } from '@/hooks/useOrderDetailsController';

// The minimal react-native surface OrderDetailsScreenContent renders, as DOM
// elements that keep the accessibility props the tests query.
export function reactNativeMock() {
  return {
    StatusBar: () => null,
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'div',
        {
          'aria-label': accessibilityLabel,
          onClick: () => onPress?.(),
          role: accessibilityRole,
        },
        children
      ),
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    View: ({
      accessibilityElementsHidden,
      children,
      importantForAccessibility,
      testID,
    }: {
      accessibilityElementsHidden?: boolean;
      children?: React.ReactNode;
      importantForAccessibility?: string;
      testID?: string;
    }) =>
      React.createElement(
        'div',
        {
          'data-accessibility-elements-hidden': String(
            Boolean(accessibilityElementsHidden)
          ),
          'data-important-for-accessibility': importantForAccessibility,
          'data-testid': testID,
        },
        children
      ),
  };
}

export function createController(
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
