import { isPaidStatus } from '@baci/shared';
import { Alert } from 'react-native';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import type {
  CancellationRefundChoice,
  OrderStatusUpdateResult,
} from '@/hooks/orders/useOrderStatusUpdate';
import type { ShippingStatus } from '@/hooks/useOrders';
import { formatCurrency } from '@/lib/utils';

const IS_DEV_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;

interface CreateOrderDetailsStatusActionsParams {
  openShipmentFlow: () => void;
  order: OrderDetailsRecord | undefined;
  setShowCreditModal: (value: boolean) => void;
  setShowPaymentOptionModal: (value: boolean) => void;
  setShowStatusModal: (value: boolean) => void;
  /** Confirm-time recheck of open provider-refund evidence (true blocks). */
  refundEvidenceBlocksChoice?: (orderId: string) => Promise<boolean>;
  setSuccessModal: (
    value:
      | {
          actionLabel: string;
          actionVariant: 'default' | 'whatsapp';
          message: string;
          showAction: boolean;
          subMessage: string;
          title: string;
          visible: boolean;
        }
      | ((previous: {
          actionLabel: string;
          actionVariant: 'default' | 'whatsapp';
          message: string;
          showAction: boolean;
          subMessage: string;
          title: string;
          visible: boolean;
        }) => {
          actionLabel: string;
          actionVariant: 'default' | 'whatsapp';
          message: string;
          showAction: boolean;
          subMessage: string;
          title: string;
          visible: boolean;
        })
  ) => void;
  updateStatus: (input: {
    orderId: string;
    refund?: CancellationRefundChoice;
    status: ShippingStatus;
  }) => Promise<OrderStatusUpdateResult | undefined>;
}

export function createOrderDetailsStatusActions({
  openShipmentFlow,
  order,
  refundEvidenceBlocksChoice,
  setShowCreditModal,
  setShowPaymentOptionModal,
  setShowStatusModal,
  setSuccessModal,
  updateStatus,
}: CreateOrderDetailsStatusActionsParams) {
  const performStatusUpdate = async (
    newStatus: ShippingStatus,
    refund?: CancellationRefundChoice
  ) => {
    if (!order) {
      return;
    }

    if (
      newStatus === 'processing' &&
      order.payment_status !== 'paid' &&
      !order.is_credit_order
    ) {
      setShowStatusModal(false);
      setShowPaymentOptionModal(true);
      return;
    }

    if (newStatus === 'shipped' && order.shipping_status === 'processing') {
      openShipmentFlow();
      return;
    }

    try {
      const result = await updateStatus({
        orderId: order.id,
        status: newStatus,
        ...(refund && { refund }),
      });
      setShowStatusModal(false);

      const refundOutcome = result?.refund_outcome;
      // Prefer what the server reports over the requested choice.
      const refundIsManual = refundOutcome
        ? refundOutcome === 'manual_required'
        : refund === 'manual';

      const refundDetails = result?.refund_details;
      const manualCurrency =
        refundDetails?.currency?.trim() || order.currency?.trim() || 'NGN';
      const manualMessage =
        refundDetails &&
        (refundDetails.inFlightAmount ?? 0) > 0 &&
        typeof refundDetails.remainingAmount === 'number'
          ? `The customer notification has been queued. ${formatCurrency(refundDetails.inFlightAmount ?? 0, undefined, manualCurrency)} is already being refunded by the provider; you only need to refund ${formatCurrency(refundDetails.remainingAmount, undefined, manualCurrency)}. Record it on the order once you have paid the customer.`
          : 'The customer notification has been queued. The refund is pending: record it on the order once you have paid the customer.';

      const subMessage =
        newStatus === 'delivered'
          ? 'The customer notification has been queued and will not block fulfillment.'
          : newStatus === 'cancelled'
            ? refundOutcome === 'unknown'
              ? "The customer notification has been queued. Check the order's refund status; do not refund the customer by hand until it shows what is owed."
              : refundIsManual
                ? manualMessage
                : isPaidStatus(order.payment_status) || order.amount_paid > 0
                  ? 'The customer notification has been queued. Check the refund status before telling the customer it is complete.'
                  : 'The customer notification has been queued.'
            : '';

      setSuccessModal({
        actionLabel: '',
        actionVariant: 'default',
        message: `Order status updated to ${newStatus}`,
        showAction: false,
        subMessage,
        title:
          newStatus === 'delivered' ? 'Order Delivered! 🎉' : 'Status Updated',
        visible: true,
      });
    } catch (error: unknown) {
      // Rejections can be nullish or non-Error: read defensively so
      // the catch itself never throws and Alert always gets text.
      const nextError: { code?: unknown; message?: unknown } =
        typeof error === 'object' && error !== null ? error : {};
      const errorMessage =
        typeof nextError.message === 'string'
          ? nextError.message
          : 'Failed to update status';

      if (
        errorMessage.includes('PAYMENT_REQUIRED') ||
        errorMessage.includes('paid before processing')
      ) {
        Alert.alert(
          'Payment Required',
          'This order must be paid before processing. Would you like to ship on credit?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Ship on Credit', onPress: () => setShowCreditModal(true) },
          ]
        );
        return;
      }

      // Read the code structurally: a rewrapped or serialized error
      // across a bundle boundary fails instanceof but still carries
      // the server's code. Both actionable cancel rejections surface
      // the server reason instead of the generic fallback.
      const errorCode = nextError.code;
      const cancellationShowsServerReason =
        newStatus === 'cancelled' &&
        (errorCode === 'PAYMENT_RECONCILIATION_REQUIRED' ||
          errorCode === 'ORDER_NOT_CANCELLABLE' ||
          errorCode === 'CANCEL_REFUND_FORBIDDEN');
      Alert.alert(
        'Error',
        cancellationShowsServerReason ? errorMessage : 'Failed to update status'
      );
      if (IS_DEV_RUNTIME) {
        console.error('Order details status update failed', {
          currentStatus: order.shipping_status,
          errorMessage,
          nextStatus: newStatus,
          orderId: order.id,
          paymentStatus: order.payment_status,
        });
      }
    }
  };

  const handleStatusUpdate = async (newStatus: ShippingStatus) => {
    if (!order || newStatus !== 'cancelled') {
      await performStatusUpdate(newStatus);
      return;
    }

    // A plan showing outstanding money means the order is paid even when
    // the cached status is stale (payment completed after the read).
    const isPaid =
      isPaidStatus(order.payment_status) ||
      order.amount_paid > 0 ||
      (order.cancel_refund_plan?.amount ?? 0) > 0;
    // The plan (outstanding external legs, Paystack-only automatic refunds)
    // is best effort. Without it we cannot say what is owed, so never offer
    // a manual refund: cancel neutrally and point at the refund status.
    const plan = order.cancel_refund_plan;
    const showNeutralCancel = () =>
      Alert.alert(
        'Cancel order?',
        "Refund details couldn't be loaded. Cancel now and check the order's refund status for what happens next; do not refund the customer by hand until it shows what is owed. This cannot be undone.",
        [
          { text: 'Keep Order', style: 'cancel' },
          {
            text: 'Cancel Order',
            style: 'destructive',
            onPress: () => {
              void performStatusUpdate(newStatus);
            },
          },
        ]
      );
    if (isPaid && (plan === undefined || !plan.ledgerKnown)) {
      showNeutralCancel();
      return;
    }
    const hasRefundChoice = isPaid && plan !== undefined && plan.amount > 0;
    if (hasRefundChoice && plan) {
      // The plan was read with the order and can be stale: recheck open
      // provider-refund evidence now, and fall back to the neutral cancel
      // (no cancel-only) when it is open or the check fails.
      if (
        refundEvidenceBlocksChoice &&
        (await refundEvidenceBlocksChoice(order.id))
      ) {
        showNeutralCancel();
        return;
      }
      const automaticSupported = plan.automaticSupported;
      // The safe automatic path is listed first (Android positions buttons
      // by order). Mobile has no staff permission data, so it always offers
      // the automatic action; for legs the worker cannot refund itself that
      // action sends the refund to owner review, and cancel-only needs refund
      // permission, which the server enforces with a 403.
      const noteCurrency = order.currency?.trim() || 'NGN';
      const inFlightNote =
        plan.inFlightAmount > 0
          ? ` The provider is already refunding ${formatCurrency(plan.inFlightAmount, undefined, noteCurrency)} of this payment: only the remaining ${formatCurrency(plan.amount, undefined, noteCurrency)} is yours to refund, so do not refund the rest yourself.`
          : '';
      Alert.alert(
        'Cancel paid order?',
        `${
          automaticSupported
            ? 'Choose how the customer gets their money back. Submit once; if the result is unclear, check the order status instead of cancelling again.'
            : 'Baci cannot refund all of this payment automatically. You can cancel and send the refund to the store owner for review, or cancel and refund the customer yourself. Submit once; if the result is unclear, check the order status instead of cancelling again.'
        }${inFlightNote}`,
        [
          { text: 'Keep Order', style: 'cancel' },
          {
            text: automaticSupported
              ? 'Cancel and refund to original payment method'
              : 'Cancel and send the refund to review',
            style: 'destructive',
            onPress: () => {
              void performStatusUpdate(newStatus, 'automatic');
            },
          },
          {
            text: 'Cancel only (I will refund them)',
            style: 'destructive',
            onPress: () => {
              void performStatusUpdate(newStatus, 'manual');
            },
          },
        ]
      );
      return;
    }
    Alert.alert(
      'Cancel order?',
      plan && plan.inFlightAmount > 0
        ? 'A refund is already in progress with the provider. Cancelling will not send another one, so wait for it to finish instead of refunding the customer yourself. This cannot be undone.'
        : 'This records who cancelled the order and restores tracked inventory. This cannot be undone.',
      [
        { text: 'Keep Order', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: () => {
            void performStatusUpdate(newStatus);
          },
        },
      ]
    );
  };

  return { handleStatusUpdate };
}
