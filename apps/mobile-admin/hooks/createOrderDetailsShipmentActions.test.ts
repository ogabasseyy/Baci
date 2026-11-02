import { Alert } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

vi.mock('@/lib/order-shipment', () => ({
  getDispatchPhoneFromOrder: vi.fn(() => null),
  getInitialFulfillmentDetails: vi.fn(() => ({
    imei: '',
    items: [],
    serialNumber: '',
  })),
  areFulfillmentDetailsComplete: vi.fn(() => false),
  getFirstIncompleteFulfillmentItemIndex: vi.fn(() => 0),
  shouldPersistFulfillmentDetails: vi.fn(() => false),
}));

vi.mock('./completeOrderShipment', () => ({
  completeOrderShipment: vi.fn(),
}));

import { completeOrderShipment } from './completeOrderShipment';
import { createOrderDetailsShipmentActions } from './createOrderDetailsShipmentActions';
import { OrderStatusUpdateError } from './orders/order-status-update-error';

function makeActions(
  overrides?: Partial<Parameters<typeof createOrderDetailsShipmentActions>[0]>
) {
  return createOrderDetailsShipmentActions({
    fulfillmentDetails: { imei: '', items: [], serialNumber: '' },
    fulfillmentItemIndex: 0,
    fulfillmentItems: [],
    handleSaveRider: vi.fn(),
    merchantId: undefined,
    order: undefined,
    pendingShipmentMode: 'self_fulfillment',
    providerBookingAvailable: false,
    providerLabel: null,
    queryClient: {} as never,
    requiresShipmentDetails: false,
    riderPhone: '',
    runAfterShipmentFlowDismissed: (task: () => void) => task(),
    setFulfillmentDetails: vi.fn(),
    setFulfillmentItemIndex: vi.fn(),
    setIsShipmentSubmitting: vi.fn(),
    setPendingShipmentMode: vi.fn(),
    setRiderPhone: vi.fn(),
    setShipmentFlowStep: vi.fn(),
    setShowShipmentFlow: vi.fn(),
    setSuccessModal: vi.fn(),
    shipmentFlowStep: 'details',
    showShipmentFlow: false,
    updateStatus: vi.fn(),
    ...overrides,
  });
}

describe('createOrderDetailsShipmentActions', () => {
  it('closes the booking flow and asks the merchant to check status once the sheet has gone when the shipment outcome is unconfirmed', async () => {
    vi.mocked(Alert.alert).mockClear();
    const setShowShipmentFlow = vi.fn();
    const afterDismiss: Array<() => void> = [];
    vi.mocked(completeOrderShipment).mockRejectedValueOnce(
      new OrderStatusUpdateError(
        'Check the order before booking again.',
        'SHIPMENT_BOOKING_UNCONFIRMED'
      )
    );
    const actions = makeActions({
      order: { id: 'order-1' } as never,
      pendingShipmentMode: 'provider',
      providerBookingAvailable: true,
      runAfterShipmentFlowDismissed: (task) => afterDismiss.push(task),
      setShowShipmentFlow,
    });

    await actions.proceedFromShipmentMethod();

    expect(setShowShipmentFlow).toHaveBeenCalledWith(false);
    expect(Alert.alert).not.toHaveBeenCalled();

    for (const task of afterDismiss) task();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Check shipment status',
      'Check the order before booking again.'
    );
  });

  it('bugfix: opens the success dialog only after the shipment sheet has gone', async () => {
    const setSuccessModal = vi.fn();
    const afterDismiss: Array<() => void> = [];
    vi.mocked(completeOrderShipment).mockResolvedValueOnce({
      actionLabel: '',
      actionVariant: 'default',
      message: 'Shipment booked',
      showAction: false,
      subMessage: '',
      title: 'Shipment Booked',
    } as never);
    const actions = makeActions({
      order: { id: 'order-1' } as never,
      pendingShipmentMode: 'provider',
      providerBookingAvailable: true,
      runAfterShipmentFlowDismissed: (task) => afterDismiss.push(task),
      setSuccessModal,
    });

    await actions.proceedFromShipmentMethod();

    expect(setSuccessModal).not.toHaveBeenCalled();
    for (const task of afterDismiss) task();
    expect(setSuccessModal).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shipment Booked', visible: true })
    );
  });

  it('does nothing in openShipmentFlow when order is undefined', () => {
    const setShowShipmentFlow = vi.fn();
    const actions = makeActions({ setShowShipmentFlow });

    actions.openShipmentFlow();

    expect(setShowShipmentFlow).not.toHaveBeenCalled();
  });

  it('resets state in closeShipmentFlow', () => {
    const setShowShipmentFlow = vi.fn();
    const setShipmentFlowStep = vi.fn();
    const setIsShipmentSubmitting = vi.fn();
    const actions = makeActions({
      setShowShipmentFlow,
      setShipmentFlowStep,
      setIsShipmentSubmitting,
    });

    actions.closeShipmentFlow();

    expect(setShowShipmentFlow).toHaveBeenCalledWith(false);
    expect(setShipmentFlowStep).toHaveBeenCalledWith('details');
    expect(setIsShipmentSubmitting).toHaveBeenCalledWith(false);
  });

  it('shows alert when fulfillment details are required but missing', () => {
    const setShipmentFlowStep = vi.fn();
    const actions = makeActions({
      requiresShipmentDetails: true,
      setShipmentFlowStep,
    });

    actions.proceedFromFulfillmentDetails();

    expect(Alert.alert).toHaveBeenCalledWith('Required', expect.any(String));
    expect(setShipmentFlowStep).not.toHaveBeenCalled();
  });

  it('advances to method step when fulfillment details are not required', () => {
    const setShipmentFlowStep = vi.fn();
    const actions = makeActions({
      requiresShipmentDetails: false,
      setShipmentFlowStep,
    });

    actions.proceedFromFulfillmentDetails();

    expect(setShipmentFlowStep).toHaveBeenCalledWith('method');
  });

  it('advances through required fulfillment items before shipping', () => {
    const setFulfillmentItemIndex = vi.fn();
    const setShipmentFlowStep = vi.fn();
    const actions = makeActions({
      fulfillmentDetails: {
        imei: '353456789012345',
        items: [
          {
            id: 'item-1:1',
            imei: '353456789012345',
            orderItemId: 'item-1',
            productName: '13" iPad Air',
            serialNumber: '',
            unitCount: 1,
            unitIndex: 0,
          },
          {
            id: 'item-2:1',
            imei: '',
            orderItemId: 'item-2',
            productName: 'Apple Pencil Pro',
            serialNumber: '',
            unitCount: 1,
            unitIndex: 0,
          },
        ],
        serialNumber: '',
      },
      fulfillmentItemIndex: 0,
      requiresShipmentDetails: true,
      setFulfillmentItemIndex,
      setShipmentFlowStep,
    });

    actions.proceedFromFulfillmentDetails();

    expect(setFulfillmentItemIndex).toHaveBeenCalledWith(1);
    expect(setShipmentFlowStep).not.toHaveBeenCalledWith('method');
  });

  it('notifies the caller before alerting on provider booking errors', async () => {
    const onProviderBookingError = vi.fn();
    vi.mocked(completeOrderShipment).mockRejectedValue(
      new OrderStatusUpdateError(
        'Insufficient merchant wallet balance.',
        'MERCHANT_WALLET_INSUFFICIENT'
      )
    );
    const actions = makeActions({
      onProviderBookingError,
      order: { id: 'order-1' } as never,
      pendingShipmentMode: 'provider',
    });

    await actions.proceedFromShipmentMethod();

    expect(onProviderBookingError).toHaveBeenCalledOnce();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Insufficient merchant wallet balance.'
    );
  });

  it('still alerts the original booking error when recovery refresh fails', async () => {
    const onProviderBookingError = vi
      .fn()
      .mockRejectedValue(new Error('wallet summary failed'));
    vi.mocked(completeOrderShipment).mockRejectedValue(
      new OrderStatusUpdateError(
        'Insufficient merchant wallet balance.',
        'MERCHANT_WALLET_INSUFFICIENT'
      )
    );
    const actions = makeActions({
      onProviderBookingError,
      order: { id: 'order-1' } as never,
      pendingShipmentMode: 'provider',
    });

    await actions.proceedFromShipmentMethod();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Insufficient merchant wallet balance.'
    );
  });

  it('alerts that the quote was updated when reconfirmation is required', async () => {
    vi.mocked(completeOrderShipment).mockRejectedValue(
      new OrderStatusUpdateError(
        'The shipping quote changed or expired.',
        'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED'
      )
    );
    const actions = makeActions({
      order: { id: 'order-1' } as never,
      pendingShipmentMode: 'provider',
    });

    await actions.proceedFromShipmentMethod();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Quote updated',
      'The shipping quote changed or expired.'
    );
  });
});
