import { OrderItemDetailModal } from '@/components/orders/OrderItemDetailModal';
import { OrderPaymentOptionDialog } from '@/components/orders/OrderPaymentOptionDialog';
import { OrderStatusSheet } from '@/components/orders/OrderStatusSheet';
import { RecordPaymentSheet } from '@/components/orders/RecordPaymentSheet';
import { ShipmentFlowSheet } from '@/components/orders/ShipmentFlowSheet';
import { ShipOnCreditDialog } from '@/components/orders/ShipOnCreditDialog';
import { ReceiptPreviewModal } from '@/components/ui/ReceiptPreviewModal';
import { SuccessModal } from '@/components/ui/SuccessModal';
import type { useOrderDetailsController } from '@/hooks/useOrderDetailsController';

type OrderDetailsController = ReturnType<typeof useOrderDetailsController>;

interface OrderDetailsScreenModalsProps {
  controller: OrderDetailsController;
  order: NonNullable<OrderDetailsController['order']>;
}

function openRecordPaymentForBalance(
  controller: OrderDetailsController,
  order: NonNullable<OrderDetailsController['order']>
) {
  controller.setShowPaymentOptionModal(false);
  const amount = Math.round(order.balance ?? order.total);
  if (amount > 0) {
    controller.setPaymentAmount(String(amount));
    controller.setShowRecordPaymentModal(true);
  }
}

export function OrderDetailsScreenModals({
  controller,
  order,
}: OrderDetailsScreenModalsProps) {
  return (
    <>
      <OrderStatusSheet
        colors={controller.colors}
        onClose={() => controller.setShowStatusModal(false)}
        onSelectStatus={(status) => void controller.handleStatusUpdate(status)}
        shippingStatus={order.shipping_status}
        visible={controller.showStatusModal}
      />

      <ShipOnCreditDialog
        colors={controller.colors}
        creditNotes={controller.creditNotes}
        isSubmitting={controller.shipOnCreditMutation.isPending}
        onClose={() => controller.setShowCreditModal(false)}
        onConfirm={() => void controller.handleShipOnCredit()}
        onCreditNotesChange={controller.setCreditNotes}
        visible={controller.showCreditModal}
      />

      <ShipmentFlowSheet
        canUseProvider={controller.providerBookingAvailable}
        fulfillmentDetails={controller.fulfillmentDetails}
        fulfillmentItemIndex={controller.fulfillmentItemIndex}
        giglShipping={controller.giglShipping}
        hasExistingFulfillment={Boolean(
          order.fulfillment_details?.imei ||
            order.fulfillment_details?.serialNumber ||
            order.fulfillment_details?.items?.some(
              (item) => item.imei || item.serialNumber || item.serial_number
            )
        )}
        isSubmitting={controller.isShipmentSubmitting}
        onClose={controller.closeShipmentFlow}
        onContinueFromDetails={controller.proceedFromFulfillmentDetails}
        onContinueFromMethod={() => void controller.proceedFromShipmentMethod()}
        onConfirmSelfFulfillment={() =>
          void controller.handleSubmitSelfFulfillment()
        }
        onFulfillmentDetailsChange={controller.updateFulfillmentDetails}
        onModeChange={controller.setPendingShipmentMode}
        onRiderPhoneChange={controller.setRiderPhone}
        onSelectSavedRider={controller.setRiderPhone}
        onStepBack={controller.handleShipmentFlowBack}
        orderNumber={order.order_number}
        providerLabel={controller.providerLabel}
        requiresFulfillment={controller.requiresShipmentDetails}
        riderPhone={controller.riderPhone}
        savedRiders={controller.savedRiders}
        selectedMode={controller.pendingShipmentMode}
        step={controller.shipmentFlowStep}
        visible={controller.showShipmentFlow}
      />

      <OrderPaymentOptionDialog
        balanceLabel={controller.formatPrice(order.balance ?? order.total)}
        colors={controller.colors}
        onClose={() => controller.setShowPaymentOptionModal(false)}
        onRecordPayment={() => openRecordPaymentForBalance(controller, order)}
        onShipOnCredit={() => {
          controller.setShowPaymentOptionModal(false);
          controller.setShowCreditModal(true);
        }}
        visible={controller.showPaymentOptionModal}
      />

      <RecordPaymentSheet
        colors={controller.colors}
        currency={controller.orderCurrency}
        currencySymbol={controller.currencySymbol}
        isConfirmDisabled={
          !controller.paymentMethod || !controller.paymentAmount
        }
        isSubmitting={controller.recordPaymentMutation.isPending}
        onAmountChange={controller.handlePaymentAmountChange}
        onClose={() => controller.setShowRecordPaymentModal(false)}
        onConfirm={() => void controller.handleRecordPayment()}
        onMethodChange={controller.setPaymentMethod}
        onNotesChange={controller.setPaymentNotes}
        paymentAmount={controller.paymentAmount}
        paymentMethod={controller.paymentMethod}
        paymentNotes={controller.paymentNotes}
        visible={controller.showRecordPaymentModal}
      />

      <SuccessModal
        visible={controller.successModal.visible}
        title={controller.successModal.title}
        message={controller.successModal.message}
        subMessage={controller.successModal.subMessage}
        actionIcon={
          controller.successModal.showAction ? 'logo-whatsapp' : undefined
        }
        actionLabel={
          controller.successModal.showAction
            ? controller.successModal.actionLabel
            : undefined
        }
        actionVariant={controller.successModal.actionVariant}
        onActionPress={
          controller.successModal.showAction
            ? () => {
                controller.setSuccessModal((previous) => ({
                  ...previous,
                  visible: false,
                }));
                void controller.handleSendOrderDetailsToRider();
              }
            : undefined
        }
        onClose={() =>
          controller.setSuccessModal((previous) => ({
            ...previous,
            visible: false,
            showAction: false,
            actionLabel: '',
            actionVariant: 'default',
          }))
        }
        closeLabel="Done"
      />

      <ReceiptPreviewModal
        visible={controller.showReceiptPreview}
        html={controller.receiptHtml}
        onClose={() => controller.setShowReceiptPreview(false)}
        onShare={() => void controller.handleShareReceiptPdf()}
        isPaid={order.payment_status === 'paid'}
      />

      <OrderItemDetailModal
        visible={controller.selectedOrderItem !== null}
        item={controller.selectedOrderItem}
        formattedUnitPrice={
          controller.selectedOrderItem
            ? controller.formatPrice(controller.selectedOrderItem.price)
            : ''
        }
        formattedLineTotal={
          controller.selectedOrderItem
            ? controller.formatPrice(
                controller.selectedOrderItem.price *
                  controller.selectedOrderItem.quantity
              )
            : ''
        }
        onClose={() => controller.setSelectedOrderItem(null)}
      />
    </>
  );
}
