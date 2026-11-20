import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrderDetailsActionsCard } from '@/components/orders/OrderDetailsActionsCard';
import { OrderDetailsClosedStateCard } from '@/components/orders/OrderDetailsClosedStateCard';
import { OrderDetailsHeaderCard } from '@/components/orders/OrderDetailsHeaderCard';
import { OrderDetailsInsuranceCard } from '@/components/orders/OrderDetailsInsuranceCard';
import { OrderDetailsItemsCard } from '@/components/orders/OrderDetailsItemsCard';
import { OrderDetailsScreenHeader } from '@/components/orders/OrderDetailsScreenHeader';
import {
  OrderDetailsErrorState,
  OrderDetailsLoadingState,
} from '@/components/orders/OrderDetailsScreenState';
import { OrderDetailsShippingAddressCard } from '@/components/orders/OrderDetailsShippingAddressCard';
import {
  type OrderDetailsSummaryBreakdown,
  OrderDetailsSummaryCard,
} from '@/components/orders/OrderDetailsSummaryCard';
import { OrderDetailsTimelineCard } from '@/components/orders/OrderDetailsTimelineCard';
import { OxygenOrderPlanCard } from '@/components/orders/OxygenOrderPlanCard';
import { useOrderDetailsController } from '@/components/orders/use-order-details-controller';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import {
  getCustomerOrderStatusMeta,
  getCustomerOrderStatusPalette,
  isCustomerOrderClosed,
} from '@/lib/customer-order-status';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import {
  getOrderAssuranceFeeTotal,
  getOrderSummaryBreakdown,
} from '@/lib/order-summary';
import {
  canLeaveStorefrontGoogleReview,
  canRequestStorefrontOrderReturn,
  canShowStorefrontRiderContact,
  isStorefrontReceiptAvailable,
} from '@/lib/post-purchase-actions';
import { createInsuranceFlowActions } from './insurance-flow-actions';
import { orderDetailsScreenStyles as styles } from './OrderDetailsScreen.styles';
import { OxygenOrderResume } from './OxygenOrderResume';
import { formatOrderDetailsDate } from './order-details.helpers';

export function OrderDetailsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const {
    canCancel,
    error,
    handleCallRider,
    handleCancelOrder,
    handleContactSupport,
    handleGoBack,
    handleLeaveGoogleReview,
    handleOpenProduct,
    handleOpenReceipt,
    handleReturnOrder,
    handleTrackOrder,
    insurancePolicy,
    isLoading,
    merchantInfo,
    order,
    receiptPreview,
    userId,
  } = useOrderDetailsController();

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <OrderDetailsLoadingState
          backgroundColor={colors.background}
          colors={colors}
        />
      </>
    );
  }

  if (error || !order) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <OrderDetailsErrorState
          backgroundColor={colors.background}
          colors={colors}
          errorMessage={error || 'Order not found'}
          onGoBack={handleGoBack}
        />
      </>
    );
  }

  const statusMeta = getCustomerOrderStatusMeta(
    order.shipping_status,
    merchantInfo?.business_name
  );
  const statusPalette = getCustomerOrderStatusPalette(order.shipping_status);
  const isClosedOrder = isCustomerOrderClosed(order.shipping_status);
  const summaryBreakdown: OrderDetailsSummaryBreakdown =
    getOrderSummaryBreakdown({
      subtotal: order.subtotal,
      shippingFee: order.shipping_fee,
      taxAmount: order.tax_amount,
      discountAmount: order.discount_amount,
      total: order.total,
      paymentStatus: order.payment_status,
      assuranceFee: getOrderAssuranceFeeTotal(
        order.items,
        insurancePolicy?.premium_amount
      ),
    });
  const {
    openInsuranceCertificateUrl,
    openInsuranceClaimFallback,
    openInsuranceFlowUrl,
  } = createInsuranceFlowActions(handleContactSupport);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top', 'left', 'right']}
      >
        <OrderDetailsScreenHeader colors={colors} onGoBack={handleGoBack} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: statusPalette.border,
                borderWidth: 1,
              },
            ]}
          >
            <OrderDetailsHeaderCard
              orderNumber={order.order_number}
              createdAt={order.created_at}
              statusMeta={statusMeta}
              statusPalette={statusPalette}
              colors={colors}
              formatDate={formatOrderDetailsDate}
            />
          </View>

          {!isClosedOrder && (
            <OrderDetailsTimelineCard
              shippingStatus={order.shipping_status}
              statusMeta={statusMeta}
              statusPalette={statusPalette}
              colors={colors}
              trackingNumber={order.tracking_number}
              onTrackOrder={handleTrackOrder}
            />
          )}

          {isClosedOrder && (
            <OrderDetailsClosedStateCard
              statusMeta={statusMeta}
              statusPalette={statusPalette}
              textSecondaryColor={colors.textSecondary}
            />
          )}

          <OxygenOrderResume order={order} />

          <OrderDetailsItemsCard
            colors={colors}
            items={order.items}
            onOpenProduct={handleOpenProduct}
          />

          <OrderDetailsInsuranceCard
            colors={colors}
            hasAssuranceItems={order.items.some((item) => item.has_assurance)}
            insurancePolicy={insurancePolicy}
            isDelivered={
              order.shipping_status === 'delivered' ||
              order.shipping_status === 'completed'
            }
            isPaid={order.payment_status === 'paid'}
            onCompleteInspection={openInsuranceFlowUrl}
            onFileClaim={openInsuranceFlowUrl}
            onFileClaimFallback={openInsuranceClaimFallback}
            onOpenCertificate={openInsuranceCertificateUrl}
          />

          <OrderDetailsShippingAddressCard
            colors={colors}
            isDark={isDark}
            shippingAddress={order.shipping_address}
          />

          <OrderDetailsSummaryCard
            colors={colors}
            formatCurrency={formatNgnCurrency}
            paymentMethod={order.payment_method}
            paymentStatus={order.payment_status}
            summaryBreakdown={summaryBreakdown}
          />

          {userId && order.payment_method === 'oxygen' && (
            <OxygenOrderPlanCard
              colors={colors}
              orderId={order.id}
              userId={userId}
            />
          )}

          <OrderDetailsActionsCard
            canCancel={canCancel}
            canLeaveReview={canLeaveStorefrontGoogleReview(
              order.shipping_status
            )}
            canReturnOrder={canRequestStorefrontOrderReturn(
              order.shipping_status
            )}
            canShowRiderContact={
              canShowStorefrontRiderContact(order.shipping_status) &&
              Boolean(merchantInfo?.rider_phone_number)
            }
            colors={colors}
            isDark={isDark}
            isReceiptReady={isStorefrontReceiptAvailable({
              paymentStatus: order.payment_status,
              shippingStatus: order.shipping_status,
            })}
            onCallRider={handleCallRider}
            onCancelOrder={handleCancelOrder}
            onLeaveGoogleReview={handleLeaveGoogleReview}
            onOpenReceipt={handleOpenReceipt}
            onReturnOrder={handleReturnOrder}
            riderPhoneNumber={merchantInfo?.rider_phone_number}
          />

          <TouchableOpacity
            style={[styles.supportButton, { borderColor: colors.border }]}
            onPress={handleContactSupport}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={20}
              color={BRAND.primary}
            />
            <Text style={[styles.supportButtonText, { color: BRAND.primary }]}>
              Need help with this order?
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      <ReceiptPreviewModal
        visible={receiptPreview.isOpen}
        html={receiptPreview.html}
        isPaid={receiptPreview.isPaid}
        onClose={receiptPreview.closePreview}
      />
    </>
  );
}
