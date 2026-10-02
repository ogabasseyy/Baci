import { Alert } from 'react-native';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import { OrderStatusUpdateError } from '@/hooks/orders/order-status-update-error';
import type { ShippingStatus } from '@/hooks/useOrders';

const IS_DEV_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;

interface CreateOrderDetailsStatusActionsParams {
  openShipmentFlow: () => void;
  order: OrderDetailsRecord | undefined;
  setShowCreditModal: (value: boolean) => void;
  setShowPaymentOptionModal: (value: boolean) => void;
  setShowStatusModal: (value: boolean) => void;
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
    status: ShippingStatus;
  }) => Promise<unknown>;
}

export function createOrderDetailsStatusActions({
  openShipmentFlow,
  order,
  setShowCreditModal,
  setShowPaymentOptionModal,
  setShowStatusModal,
  setSuccessModal,
  updateStatus,
}: CreateOrderDetailsStatusActionsParams) {
  const performStatusUpdate = async (newStatus: ShippingStatus) => {
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
      await updateStatus({ orderId: order.id, status: newStatus });
      setShowStatusModal(false);

      const subMessage =
        newStatus === 'delivered'
          ? 'The customer notification has been queued and will not block fulfillment.'
          : newStatus === 'cancelled'
            ? order.payment_status === 'paid' || order.amount_paid > 0
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
      const errorCode =
        nextError instanceof OrderStatusUpdateError
          ? nextError.code
          : nextError.code;
      const cancellationShowsServerReason =
        newStatus === 'cancelled' &&
        (errorCode === 'PAYMENT_RECONCILIATION_REQUIRED' ||
          errorCode === 'ORDER_NOT_CANCELLABLE');
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

    const isPaid = order.payment_status === 'paid' || order.amount_paid > 0;
    Alert.alert(
      isPaid ? 'Cancel paid order?' : 'Cancel order?',
      isPaid
        ? 'Cancelling this paid order starts the customer refund process. Completion may take time or require review. Submit once; if the result is unclear, check the order status instead of cancelling again.'
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
