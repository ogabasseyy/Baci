import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useMerchant } from '@/hooks/useMerchant';
import type { useOrderDetailsController } from '@/hooks/useOrderDetailsController';
import { buildOrderPaymentBreakdown } from '@/lib/order-payment-breakdown';
import { OrderAuditTrailCard } from './OrderAuditTrailCard';
import { OrderDetailsFooterBar } from './OrderDetailsFooterBar';
import { OrderDetailsHeaderActions } from './OrderDetailsHeaderActions';
import { OrderDetailsItemsAndPaymentSection } from './OrderDetailsItemsAndPaymentSection';
import { OrderDetailsOverviewSection } from './OrderDetailsOverviewSection';
import { OrderDetailsScreenModals } from './OrderDetailsScreenModals';
import { OrderDetailsShippingSection } from './OrderDetailsShippingSection';
import { shouldHideOrderDetailsContentFromAccessibility } from './order-details-accessibility';

interface OrderDetailsScreenContentProps {
  controller: ReturnType<typeof useOrderDetailsController>;
}

export function OrderDetailsScreenContent({
  controller,
}: OrderDetailsScreenContentProps) {
  const { merchant } = useMerchant();
  const order = controller.order;

  if (!order) {
    return null;
  }
  const canEditOrder = !['cancelled', 'returned'].includes(
    String(order.shipping_status)
  );
  const hideMainContentFromAccessibility =
    shouldHideOrderDetailsContentFromAccessibility(controller);
  const paymentBreakdown = buildOrderPaymentBreakdown({
    currency: order.currency,
    discountAmount: order.discount_amount,
    giftWrappingFee: order.gift_wrapping_fee,
    merchant,
    shippingFee: order.shipping_fee,
    subtotal: order.subtotal,
    taxAmount: order.tax_amount,
    taxBasis: order.tax_basis,
    taxExclusiveAmount: order.tax_exclusive_amount,
    taxInclusiveAmount: order.tax_inclusive_amount,
    total: order.total,
    walletAmountUsed: order.wallet_amount_used,
  });

  return (
    <View style={{ backgroundColor: controller.colors.background, flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: order.order_number,
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: controller.colors.background },
          headerTintColor: controller.colors.text,
          headerRight: () => (
            <OrderDetailsHeaderActions
              canEditOrder={canEditOrder}
              colors={controller.colors}
              onShare={controller.handleShare}
              orderId={order.id}
            />
          ),
        }}
      />
      <View
        accessibilityElementsHidden={hideMainContentFromAccessibility}
        importantForAccessibility={
          hideMainContentFromAccessibility ? 'no-hide-descendants' : 'auto'
        }
        style={{ flex: 1 }}
        testID="order-details-main-content"
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          <OrderDetailsOverviewSection
            colors={controller.colors}
            createdAtLabel={controller.formatDate(order.created_at)}
            customerEmail={order.customer_email}
            customerName={order.customer_name}
            customerPhone={order.customer_phone}
            isGeneratingReceipt={controller.isGeneratingReceipt}
            onCall={controller.handleCall}
            onEmail={controller.handleEmail}
            onSendOrderDetailsToRider={() =>
              void controller.handleSendOrderDetailsToRider()
            }
            onSendReceipt={() => void controller.handleSendReceipt()}
            onSendRiderToCustomer={controller.handleSendRiderToCustomer}
            onWhatsApp={controller.handleWhatsApp}
            recordedByName={order.recorded_by_name}
            riderPhone={controller.riderPhone}
            shippingColor={controller.shippingColor}
            shippingConfig={{
              icon: controller.shippingConfig.icon,
              label: controller.shippingConfig.label,
            }}
            shippingStatus={order.shipping_status}
            showPostShipmentActions={controller.showPostShipmentActions}
            source={order.source}
            sourceInfo={controller.sourceInfo}
            onRiderPhoneChange={controller.setRiderPhone}
            updatedAtLabel={controller.formatDate(order.updated_at)}
          />
          <OrderDetailsItemsAndPaymentSection
            amountPaid={Number(order.amount_paid) || 0}
            balance={order.balance}
            colors={controller.colors}
            discountAmount={order.discount_amount}
            formatPrice={controller.formatPrice}
            giftWrappingFee={paymentBreakdown.giftWrappingFee}
            items={order.items || []}
            onRecordPayment={() => {
              const amount = Math.round(order.balance ?? order.total);
              if (amount > 0) {
                controller.setPaymentAmount(String(amount));
                controller.setShowRecordPaymentModal(true);
              }
            }}
            onRequestPayment={() => void controller.handleSendReminder()}
            onSelectItem={(item) =>
              controller.setSelectedOrderItem({
                ...item,
                product_id: item.product_id ?? undefined,
              })
            }
            paymentColor={controller.paymentColor}
            paymentLabel={controller.paymentConfig.label}
            paymentMethod={order.payment_method}
            paymentStatus={order.payment_status}
            shippingFee={order.shipping_fee}
            showVat={paymentBreakdown.showVat}
            subtotal={paymentBreakdown.displaySubtotal ?? order.subtotal}
            taxAmount={paymentBreakdown.taxAmount}
            total={order.total}
            vatLabel={paymentBreakdown.vatLabel}
            walletAmountUsed={paymentBreakdown.walletAmountUsed}
          />
          <OrderDetailsShippingSection
            address={controller.formatAddress(order.shipping_address)}
            airportType={order.airport_type}
            colors={controller.colors}
            deliveryMethod={order.delivery_method}
          />

          <OrderAuditTrailCard
            colors={controller.colors}
            events={controller.auditEvents}
            formatDate={controller.formatDate}
            isError={controller.isAuditEventsError}
            isLoading={controller.isAuditEventsLoading}
          />
        </ScrollView>

        <OrderDetailsFooterBar
          colors={controller.colors}
          currentStatusLabel={controller.shippingConfig.label}
          onPress={() => controller.setShowStatusModal(true)}
          statusColor={controller.shippingColor}
        />
      </View>

      <OrderDetailsScreenModals controller={controller} order={order} />
    </View>
  );
}
