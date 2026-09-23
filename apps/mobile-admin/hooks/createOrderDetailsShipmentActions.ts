import type { QueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import {
  areFulfillmentDetailsComplete,
  getDispatchPhoneFromOrder,
  getFirstIncompleteFulfillmentItemIndex,
  getInitialFulfillmentDetails,
  type ShipmentCompletionMode,
  type ShipmentFlowStep,
  type ShipmentFulfillmentDetails,
  type ShipmentFulfillmentItem,
  shouldPersistFulfillmentDetails,
} from '@/lib/order-shipment';
import { completeOrderShipment } from './completeOrderShipment';
import { OrderStatusUpdateError } from './orders/order-status-update-error';

interface SuccessModalState {
  actionLabel: string;
  actionVariant: 'default' | 'whatsapp';
  message: string;
  showAction: boolean;
  subMessage: string;
  title: string;
  visible: boolean;
}

interface CreateOrderDetailsShipmentActionsParams {
  fulfillmentDetails: ShipmentFulfillmentDetails;
  fulfillmentItemIndex: number;
  fulfillmentItems: ShipmentFulfillmentItem[];
  handleSaveRider: (phone: string) => Promise<void>;
  merchantId: string | undefined;
  order: OrderDetailsRecord | undefined;
  pendingShipmentMode: ShipmentCompletionMode;
  providerBookingAvailable: boolean;
  providerLabel: string | null;
  queryClient: QueryClient;
  requiresShipmentDetails: boolean;
  riderPhone: string;
  setFulfillmentDetails: (value: ShipmentFulfillmentDetails) => void;
  setFulfillmentItemIndex: (value: number) => void;
  setIsShipmentSubmitting: (value: boolean) => void;
  setPendingShipmentMode: (value: ShipmentCompletionMode) => void;
  setRiderPhone: (value: string) => void;
  setShipmentFlowStep: (value: ShipmentFlowStep) => void;
  setShowShipmentFlow: (value: boolean) => void;
  setShowStatusModal: (value: boolean) => void;
  setSuccessModal: (value: SuccessModalState) => void;
  shipmentFlowStep: ShipmentFlowStep;
  showShipmentFlow: boolean;
  updateStatus: (input: {
    orderId: string;
    status: 'shipped';
  }) => Promise<unknown>;
  onProviderBookingError?: (error: unknown) => void | Promise<void>;
}

export function createOrderDetailsShipmentActions({
  fulfillmentDetails,
  fulfillmentItemIndex,
  fulfillmentItems,
  handleSaveRider,
  merchantId,
  order,
  pendingShipmentMode,
  providerBookingAvailable,
  providerLabel,
  queryClient,
  requiresShipmentDetails,
  riderPhone,
  setFulfillmentDetails,
  setFulfillmentItemIndex,
  setIsShipmentSubmitting,
  setPendingShipmentMode,
  setRiderPhone,
  setShipmentFlowStep,
  setShowShipmentFlow,
  setShowStatusModal,
  setSuccessModal,
  shipmentFlowStep,
  showShipmentFlow,
  updateStatus,
  onProviderBookingError,
}: CreateOrderDetailsShipmentActionsParams) {
  const closeShipmentFlow = () => {
    setShowShipmentFlow(false);
    setShipmentFlowStep('details');
    setFulfillmentItemIndex(0);
    setPendingShipmentMode(
      providerBookingAvailable ? 'provider' : 'self_fulfillment'
    );
    setIsShipmentSubmitting(false);
  };

  const handleShipmentFlowBack = () => {
    if (!showShipmentFlow) {
      return;
    }
    if (shipmentFlowStep === 'rider') {
      setShipmentFlowStep('method');
      return;
    }
    if (shipmentFlowStep === 'method' && requiresShipmentDetails) {
      setShipmentFlowStep('details');
      setFulfillmentItemIndex(Math.max(fulfillmentDetails.items.length - 1, 0));
      return;
    }
    if (shipmentFlowStep === 'details' && fulfillmentItemIndex > 0) {
      setFulfillmentItemIndex(fulfillmentItemIndex - 1);
      return;
    }
    closeShipmentFlow();
  };

  const openShipmentFlow = () => {
    if (!order) {
      return;
    }

    setShowStatusModal(false);
    setFulfillmentDetails(
      getInitialFulfillmentDetails(order.fulfillment_details, fulfillmentItems)
    );
    setFulfillmentItemIndex(0);
    setRiderPhone(getDispatchPhoneFromOrder(order) || '');
    setPendingShipmentMode(
      providerBookingAvailable ? 'provider' : 'self_fulfillment'
    );
    setShipmentFlowStep(requiresShipmentDetails ? 'details' : 'method');
    setShowShipmentFlow(true);
  };

  const finalizeShipmentCompletion = async (mode: ShipmentCompletionMode) => {
    if (!order) {
      return;
    }
    if (
      shouldPersistFulfillmentDetails(fulfillmentDetails) &&
      !merchantId?.trim()
    ) {
      throw new Error('Merchant information is unavailable. Please try again.');
    }

    setIsShipmentSubmitting(true);

    try {
      const modalState = await completeOrderShipment({
        fulfillmentDetails,
        handleSaveRider,
        merchantId: merchantId ?? '',
        mode,
        order,
        providerBookingAvailable,
        providerLabel: providerLabel || '',
        queryClient,
        riderPhone,
        saveDetails: shouldPersistFulfillmentDetails(fulfillmentDetails),
        updateStatus,
      });

      closeShipmentFlow();
      setFulfillmentDetails({ imei: '', items: [], serialNumber: '' });
      setSuccessModal({ ...modalState, visible: true });
    } finally {
      setIsShipmentSubmitting(false);
    }
  };

  const proceedFromFulfillmentDetails = () => {
    if (
      requiresShipmentDetails &&
      !(
        fulfillmentDetails.items[fulfillmentItemIndex]?.imei.trim() ||
        fulfillmentDetails.items[fulfillmentItemIndex]?.serialNumber.trim() ||
        (fulfillmentDetails.items.length === 0 &&
          shouldPersistFulfillmentDetails(fulfillmentDetails))
      )
    ) {
      Alert.alert('Required', 'Please enter the IMEI or serial number');
      return;
    }

    if (
      requiresShipmentDetails &&
      fulfillmentItemIndex < fulfillmentDetails.items.length - 1
    ) {
      setFulfillmentItemIndex(fulfillmentItemIndex + 1);
      return;
    }

    if (
      requiresShipmentDetails &&
      !areFulfillmentDetailsComplete(fulfillmentDetails)
    ) {
      const incompleteIndex =
        getFirstIncompleteFulfillmentItemIndex(fulfillmentDetails);
      setFulfillmentItemIndex(Math.max(incompleteIndex, 0));
      Alert.alert(
        'Required',
        'Please enter every device IMEI or serial number'
      );
      return;
    }

    setShipmentFlowStep('method');
  };

  const proceedFromShipmentMethod = async () => {
    if (pendingShipmentMode === 'self_fulfillment') {
      setShipmentFlowStep('rider');
      return;
    }

    try {
      await finalizeShipmentCompletion('provider');
    } catch (error: unknown) {
      try {
        await onProviderBookingError?.(error);
      } catch {
        // Recovery refresh failures must not hide the original booking error.
      }
      const code =
        error instanceof OrderStatusUpdateError ? error.code : undefined;
      Alert.alert(
        code === 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED'
          ? 'Quote updated'
          : 'Error',
        (error as Error).message || 'Failed to mark order as shipped'
      );
    }
  };

  const handleSubmitSelfFulfillment = async () => {
    try {
      await finalizeShipmentCompletion('self_fulfillment');
    } catch (error: unknown) {
      Alert.alert(
        'Error',
        (error as Error).message || 'Failed to save fulfillment details'
      );
    }
  };

  return {
    closeShipmentFlow,
    handleShipmentFlowBack,
    handleSubmitSelfFulfillment,
    openShipmentFlow,
    proceedFromFulfillmentDetails,
    proceedFromShipmentMethod,
  };
}
