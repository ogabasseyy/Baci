import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderDetailsScreenModals } from './OrderDetailsScreenModals';

vi.mock('@/components/orders/OrderItemDetailModal', () => ({
  OrderItemDetailModal: () => null,
}));

vi.mock('@/components/orders/OrderPaymentOptionDialog', async () => {
  const React = await import('react');
  return {
    OrderPaymentOptionDialog: ({
      onClose,
      onRecordPayment,
      onShipOnCredit,
      visible,
    }: {
      onClose: () => void;
      onRecordPayment: () => void;
      onShipOnCredit: () => void;
      visible: boolean;
    }) =>
      visible
        ? React.createElement(
            'div',
            null,
            React.createElement(
              'button',
              { onClick: onRecordPayment, type: 'button' },
              'Record payment'
            ),
            React.createElement(
              'button',
              { onClick: onShipOnCredit, type: 'button' },
              'Ship on credit'
            ),
            React.createElement(
              'button',
              { onClick: onClose, type: 'button' },
              'Close payment options'
            )
          )
        : null,
  };
});

vi.mock('@/components/orders/OrderStatusSheet', () => ({
  OrderStatusSheet: () => null,
}));

vi.mock('@/components/orders/RecordPaymentSheet', async () => {
  const React = await import('react');
  return {
    RecordPaymentSheet: ({ visible }: { visible: boolean }) =>
      visible ? React.createElement('div', null, 'record-payment-sheet') : null,
  };
});

const shipmentFlow = vi.hoisted(() => ({
  proceed: undefined as undefined | (() => unknown),
}));
vi.mock('@/components/orders/ShipmentFlowSheet', () => ({
  ShipmentFlowSheet: (props: { onContinueFromMethod: () => unknown }) => {
    shipmentFlow.proceed = props.onContinueFromMethod;
    return null;
  },
}));

vi.mock('@/components/orders/ShipOnCreditDialog', () => ({
  ShipOnCreditDialog: () => null,
}));

vi.mock('@/components/ui/ReceiptPreviewModal', () => ({
  ReceiptPreviewModal: () => null,
}));

vi.mock('@/components/ui/SuccessModal', async () => {
  const React = await import('react');
  return {
    SuccessModal: ({
      actionLabel,
      onActionPress,
      onClose,
      visible,
    }: {
      actionLabel?: string;
      onActionPress?: () => void;
      onClose: () => void;
      visible: boolean;
    }) =>
      visible
        ? React.createElement(
            'div',
            null,
            actionLabel && onActionPress
              ? React.createElement(
                  'button',
                  { onClick: onActionPress, type: 'button' },
                  actionLabel
                )
              : null,
            React.createElement(
              'button',
              { onClick: onClose, type: 'button' },
              'Done'
            )
          )
        : null,
  };
});

type ModalProps = ComponentProps<typeof OrderDetailsScreenModals>;

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    balance: 1500,
    fulfillment_details: null,
    order_number: 'ORD-1',
    payment_status: 'partially_paid',
    shipping_status: 'processing',
    total: 4000,
    ...overrides,
  } as ModalProps['order'];
}

function createController(
  overrides: Partial<ModalProps['controller']> = {}
): ModalProps['controller'] {
  return {
    closeShipmentFlow: vi.fn(),
    colors: {},
    creditNotes: '',
    currencySymbol: '₦',
    fulfillmentDetails: {},
    fulfillmentItemIndex: 0,
    formatPrice: (value: number) => `₦${value}`,
    handlePaymentAmountChange: vi.fn(),
    handleRecordPayment: vi.fn(),
    handleSendOrderDetailsToRider: vi.fn(),
    handleShareReceiptPdf: vi.fn(),
    handleShipmentFlowBack: vi.fn(),
    handleShipOnCredit: vi.fn(),
    handleStatusUpdate: vi.fn(),
    handleSubmitSelfFulfillment: vi.fn(),
    isShipmentSubmitting: false,
    paymentAmount: '',
    paymentMethod: 'transfer',
    paymentNotes: '',
    pendingShipmentMode: 'self',
    proceedFromFulfillmentDetails: vi.fn(),
    proceedFromShipmentMethod: vi.fn(),
    providerBookingAvailable: false,
    providerLabel: 'Provider',
    receiptHtml: '<html></html>',
    recordPaymentMutation: { isPending: false },
    requiresShipmentDetails: false,
    riderPhone: '',
    savedRiders: [],
    selectedOrderItem: null,
    setCreditNotes: vi.fn(),
    setFulfillmentItemIndex: vi.fn(),
    setPaymentAmount: vi.fn(),
    setPaymentMethod: vi.fn(),
    setPaymentNotes: vi.fn(),
    setPendingShipmentMode: vi.fn(),
    setRiderPhone: vi.fn(),
    setSelectedOrderItem: vi.fn(),
    setShowCreditModal: vi.fn(),
    setShowPaymentOptionModal: vi.fn(),
    setShowReceiptPreview: vi.fn(),
    setShowRecordPaymentModal: vi.fn(),
    setShowStatusModal: vi.fn(),
    setSuccessModal: vi.fn(),
    shipOnCreditMutation: { isPending: false },
    shipmentFlowStep: 'method',
    showCreditModal: false,
    showPaymentOptionModal: true,
    showReceiptPreview: false,
    showRecordPaymentModal: false,
    showShipmentFlow: false,
    showStatusModal: false,
    successModal: {
      actionLabel: '',
      actionVariant: 'default',
      message: '',
      showAction: false,
      subMessage: '',
      title: '',
      visible: false,
    },
    updateFulfillmentDetails: vi.fn(),
    ...overrides,
  } as ModalProps['controller'];
}

describe('OrderDetailsScreenModals', () => {
  it('wires the balance payment helper to controller modal state', () => {
    const controller = createController();

    render(
      <OrderDetailsScreenModals controller={controller} order={createOrder()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(controller.setShowPaymentOptionModal).toHaveBeenCalledWith(false);
    expect(controller.setPaymentAmount).toHaveBeenCalledWith('1500');
    expect(controller.setShowRecordPaymentModal).toHaveBeenCalledWith(true);
  });

  it.each([
    0, -100,
  ])('does not open the record-payment sheet when balance is %s', (balance) => {
    const controller = createController();

    render(
      <OrderDetailsScreenModals
        controller={controller}
        order={createOrder({ balance })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(controller.setShowPaymentOptionModal).toHaveBeenCalledWith(false);
    expect(controller.setPaymentAmount).not.toHaveBeenCalled();
    expect(controller.setShowRecordPaymentModal).not.toHaveBeenCalled();
  });

  it('switches from payment options to ship-on-credit confirmation', () => {
    const controller = createController();

    render(
      <OrderDetailsScreenModals controller={controller} order={createOrder()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ship on credit' }));

    expect(controller.setShowPaymentOptionModal).toHaveBeenCalledWith(false);
    expect(controller.setShowCreditModal).toHaveBeenCalledWith(true);
  });

  it('closes success modal before sending rider details from the action', () => {
    const controller = createController({
      successModal: {
        actionLabel: 'Send to rider',
        actionVariant: 'default',
        message: 'Ready',
        showAction: true,
        subMessage: '',
        title: 'Sent',
        visible: true,
      },
    });

    render(
      <OrderDetailsScreenModals controller={controller} order={createOrder()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send to rider' }));

    expect(controller.setSuccessModal).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(controller.handleSendOrderDetailsToRider).toHaveBeenCalledTimes(1);
  });
});

it('preserves the controller checkout-review promise through to the shipment sheet', async () => {
  const proceed = vi.fn().mockResolvedValue('review_checkout_quote');
  render(
    <OrderDetailsScreenModals
      controller={createController({ proceedFromShipmentMethod: proceed })}
      order={createOrder()}
    />
  );
  await expect(shipmentFlow.proceed?.()).resolves.toBe('review_checkout_quote');
  expect(proceed).toHaveBeenCalledOnce();
});
