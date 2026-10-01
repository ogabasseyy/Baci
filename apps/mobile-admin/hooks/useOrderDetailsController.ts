import { PAYMENT_STATUS_CONFIG, SHIPPING_STATUS_CONFIG } from '@baci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import {
  formatOrderDetailsDate,
  formatOrderDetailsPrice,
} from '@/components/orders/order-details.formatters';
import {
  formatOrderAddress,
  getOrderCurrencySymbol,
  getOrderSourceInfo,
  getOrderStatusColor,
  normalizeOrderDetailsShippingStatus,
} from '@/components/orders/order-details.helpers';
import { createOrderDetailsContactActions } from '@/hooks/createOrderDetailsContactActions';
import { createOrderDetailsPaymentActions } from '@/hooks/createOrderDetailsPaymentActions';
import { createOrderDetailsReceiptActions } from '@/hooks/createOrderDetailsReceiptActions';
import { createOrderDetailsShipmentActions } from '@/hooks/createOrderDetailsShipmentActions';
import { createOrderDetailsStatusActions } from '@/hooks/createOrderDetailsStatusActions';
import { handleOrderDetailsProviderBookingError } from '@/hooks/handleOrderDetailsProviderBookingError';
import { useOrderAuditEvents } from '@/hooks/orders/useOrderAuditEvents';
import { useAuth } from '@/hooks/useAuth';
import { useGiglAdminShippingEligibility } from '@/hooks/useGiglAdminShippingEligibility';
import { useMerchant } from '@/hooks/useMerchant';
import { useOrderDetailsBackHandler } from '@/hooks/useOrderDetailsBackHandler';
import { useOrderDetailsGiglShipping } from '@/hooks/useOrderDetailsGiglShipping';
import { useOrderDetailsStartupEffects } from '@/hooks/useOrderDetailsStartupEffects';
import { useOrderDetailsUiState } from '@/hooks/useOrderDetailsUiState';
import {
  type PaymentStatus,
  useOrder,
  useRecordPayment,
  useSendReminder,
  useShipOnCredit,
  useUpdateOrderStatus,
} from '@/hooks/useOrders';
import { useTheme } from '@/hooks/useTheme';
import {
  formatShippingProviderName,
  getOrderFulfillmentIdentifierItems,
  orderRequiresFulfillment,
  updateShipmentFulfillmentDetails,
} from '@/lib/order-shipment';
import { orderDetailsRouteParamsSchema } from '@/schemas/order-details-route-params';

export function useOrderDetailsController() {
  const rawParams = useLocalSearchParams<{
    action?: string;
    id: string;
  }>();
  const { colors } = useTheme();
  const routeResult = orderDetailsRouteParamsSchema.safeParse({
    action: Array.isArray(rawParams.action)
      ? rawParams.action[0]
      : rawParams.action,
    id: Array.isArray(rawParams.id) ? rawParams.id[0] : rawParams.id,
  });
  const validatedParams = routeResult.success ? routeResult.data : null;
  const orderId = validatedParams?.id;
  const actionParam = validatedParams?.action;

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: order, error, isLoading } = useOrder(orderId ?? '');
  const { merchant, storeUrl } = useMerchant();
  const giglEligibility = useGiglAdminShippingEligibility(merchant);
  const auditEventsQuery = useOrderAuditEvents({
    merchantId: order?.merchant_id ?? merchant?.id,
    orderId: order?.id ?? orderId,
  });
  // Orders stamp their own currency at checkout time (`orders.currency`).
  // Historical orders can predate a merchant payout-currency change, so the
  // order's own currency wins; the merchant's current payout currency is
  // only a fallback for legacy rows without a stamped currency or while the
  // order hasn't loaded yet.
  const orderCurrency = order?.currency || merchant?.payout_currency || 'NGN';
  const currencySymbol = getOrderCurrencySymbol(orderCurrency);
  const updateStatusMutation = useUpdateOrderStatus();
  const shipOnCreditMutation = useShipOnCredit();
  const sendReminderMutation = useSendReminder();
  const recordPaymentMutation = useRecordPayment();
  const providerLabel = formatShippingProviderName(order?.shipping_provider);
  const uiState = useOrderDetailsUiState();
  const { effectiveProviderLabel, giglShipping, providerBookingAvailable } =
    useOrderDetailsGiglShipping({
      giglEligible: giglEligibility.isEligible,
      merchant,
      order,
      pendingShipmentMode: uiState.pendingShipmentMode,
      providerLabel,
      shipmentFlowStep: uiState.shipmentFlowStep,
      showShipmentFlow: uiState.showShipmentFlow,
      userId: user?.id,
    });

  const requiresShipmentDetails = orderRequiresFulfillment(
    order?.items,
    merchant?.business_type
  );
  const fulfillmentItems = getOrderFulfillmentIdentifierItems(
    order?.items,
    merchant?.business_type
  );
  useOrderDetailsBackHandler({
    fulfillmentItemIndex: uiState.fulfillmentItemIndex,
    requiresShipmentDetails,
    selectedOrderItemOpen: uiState.selectedOrderItem !== null,
    setFulfillmentItemIndex: uiState.setFulfillmentItemIndex,
    setIsShipmentSubmitting: uiState.setIsShipmentSubmitting,
    setSelectedOrderItemOpen: (value) =>
      uiState.setSelectedOrderItem(value ? uiState.selectedOrderItem : null),
    setShowCreditModal: uiState.setShowCreditModal,
    setShowPaymentOptionModal: uiState.setShowPaymentOptionModal,
    setShowRecordPaymentModal: uiState.setShowRecordPaymentModal,
    setShowShipmentFlow: uiState.setShowShipmentFlow,
    setShowStatusModal: uiState.setShowStatusModal,
    setShipmentFlowStep: uiState.setShipmentFlowStep,
    shipmentFlowStep: uiState.shipmentFlowStep,
    showCreditModal: uiState.showCreditModal,
    showPaymentOptionModal: uiState.showPaymentOptionModal,
    showRecordPaymentModal: uiState.showRecordPaymentModal,
    showShipmentFlow: uiState.showShipmentFlow,
    showStatusModal: uiState.showStatusModal,
  });

  useOrderDetailsStartupEffects({
    actionParam,
    order: order ?? null,
    setPaymentAmount: uiState.setPaymentAmount,
    setRiderPhone: uiState.setRiderPhone,
    setSavedRiders: uiState.setSavedRiders,
    setShowCreditModal: uiState.setShowCreditModal,
    setShowRecordPaymentModal: uiState.setShowRecordPaymentModal,
  });

  const formatPrice = (amount: number) =>
    formatOrderDetailsPrice(amount, orderCurrency);
  const formatDate = formatOrderDetailsDate;

  const contactActions = createOrderDetailsContactActions({
    formatPrice,
    merchant,
    order,
    riderPhone: uiState.riderPhone,
    savedRiders: uiState.savedRiders,
    setSavedRiders: uiState.setSavedRiders,
  });

  const paymentActions = createOrderDetailsPaymentActions({
    creditNotes: uiState.creditNotes,
    formatPrice,
    order,
    paymentAmount: uiState.paymentAmount,
    paymentMethod: uiState.paymentMethod,
    paymentNotes: uiState.paymentNotes,
    recordPayment: recordPaymentMutation.mutateAsync,
    sendReminder: sendReminderMutation.mutateAsync,
    setCreditNotes: uiState.setCreditNotes,
    setPaymentAmount: uiState.setPaymentAmount,
    setPaymentMethod: uiState.setPaymentMethod,
    setPaymentNotes: uiState.setPaymentNotes,
    setShowCreditModal: uiState.setShowCreditModal,
    setShowRecordPaymentModal: uiState.setShowRecordPaymentModal,
    shipOnCredit: shipOnCreditMutation.mutateAsync,
  });

  const shipmentActions = createOrderDetailsShipmentActions({
    fulfillmentDetails: uiState.fulfillmentDetails,
    fulfillmentItemIndex: uiState.fulfillmentItemIndex,
    fulfillmentItems,
    handleSaveRider: contactActions.handleSaveRider,
    merchantId: merchant?.id,
    order,
    pendingShipmentMode: uiState.pendingShipmentMode,
    providerBookingAvailable:
      providerBookingAvailable || Boolean(giglShipping?.wallet?.canBook),
    providerLabel: effectiveProviderLabel,
    queryClient,
    requiresShipmentDetails,
    riderPhone: uiState.riderPhone,
    setFulfillmentDetails: uiState.setFulfillmentDetails,
    setFulfillmentItemIndex: uiState.setFulfillmentItemIndex,
    setIsShipmentSubmitting: uiState.setIsShipmentSubmitting,
    setPendingShipmentMode: uiState.setPendingShipmentMode,
    setRiderPhone: uiState.setRiderPhone,
    setShipmentFlowStep: uiState.setShipmentFlowStep,
    setShowShipmentFlow: uiState.setShowShipmentFlow,
    setShowStatusModal: uiState.setShowStatusModal,
    setSuccessModal: uiState.setSuccessModal,
    shipmentFlowStep: uiState.shipmentFlowStep,
    showShipmentFlow: uiState.showShipmentFlow,
    updateStatus: updateStatusMutation.mutateAsync,
    onProviderBookingError: (error) =>
      handleOrderDetailsProviderBookingError(error, giglShipping),
  });

  const statusActions = createOrderDetailsStatusActions({
    openShipmentFlow: shipmentActions.openShipmentFlow,
    order,
    setShowCreditModal: uiState.setShowCreditModal,
    setShowPaymentOptionModal: uiState.setShowPaymentOptionModal,
    setShowStatusModal: uiState.setShowStatusModal,
    setSuccessModal: uiState.setSuccessModal,
    updateStatus: updateStatusMutation.mutateAsync,
  });

  const receiptActions = createOrderDetailsReceiptActions({
    isGeneratingReceipt: uiState.isGeneratingReceipt,
    merchant,
    order,
    receiptHtml: uiState.receiptHtml,
    setIsGeneratingReceipt: uiState.setIsGeneratingReceipt,
    setReceiptHtml: uiState.setReceiptHtml,
    setShowReceiptPreview: uiState.setShowReceiptPreview,
    storeUrl,
  });

  const normalizedShippingStatus = normalizeOrderDetailsShippingStatus(
    order?.shipping_status
  );
  const shippingConfig = SHIPPING_STATUS_CONFIG[normalizedShippingStatus];
  const paymentConfig = order?.payment_status
    ? PAYMENT_STATUS_CONFIG[order.payment_status as PaymentStatus] ||
      PAYMENT_STATUS_CONFIG.pending
    : PAYMENT_STATUS_CONFIG.pending;
  const shippingColor = getOrderStatusColor(colors, shippingConfig.colorKey);
  const paymentColor = getOrderStatusColor(colors, paymentConfig.colorKey);
  const sourceInfo = getOrderSourceInfo(colors, order?.source);
  // The rider phone can be added after self-fulfillment; action handlers validate it before opening WhatsApp.
  const showPostShipmentActions = Boolean(
    order?.shipping_status === 'shipped' && order?.self_fulfillment_data
  );
  const isInvalidRoute = !validatedParams;
  const updateFulfillmentDetails = (
    field: 'imei' | 'serialNumber',
    value: string
  ) =>
    uiState.setFulfillmentDetails((previous) =>
      updateShipmentFulfillmentDetails(
        previous,
        uiState.fulfillmentItemIndex,
        field,
        value
      )
    );

  return {
    ...uiState,
    auditEvents: auditEventsQuery.data ?? [],
    closeShipmentFlow: shipmentActions.closeShipmentFlow,
    colors,
    currencySymbol,
    error,
    formatAddress: formatOrderAddress,
    formatDate,
    formatPrice,
    giglShipping,
    handleCall: contactActions.handleCall,
    handleEmail: contactActions.handleEmail,
    handlePaymentAmountChange: paymentActions.handlePaymentAmountChange,
    handleRecordPayment: paymentActions.handleRecordPayment,
    handleSendOrderDetailsToRider: contactActions.handleSendOrderDetailsToRider,
    handleSendReceipt: receiptActions.handleSendReceipt,
    handleSendReminder: paymentActions.handleSendReminder,
    handleSendRiderToCustomer: contactActions.handleSendRiderToCustomer,
    handleShare: contactActions.handleShare,
    handleShareReceiptPdf: receiptActions.handleShareReceiptPdf,
    handleShipOnCredit: paymentActions.handleShipOnCredit,
    handleShipmentFlowBack: shipmentActions.handleShipmentFlowBack,
    handleStatusUpdate: statusActions.handleStatusUpdate,
    handleSubmitSelfFulfillment: shipmentActions.handleSubmitSelfFulfillment,
    handleWhatsApp: contactActions.handleWhatsApp,
    isAuditEventsLoading: auditEventsQuery.isLoading,
    isAuditEventsError: auditEventsQuery.isError,
    isInvalidRoute,
    isLoading,
    order,
    orderCurrency,
    orderId,
    paymentColor,
    paymentConfig,
    proceedFromFulfillmentDetails:
      shipmentActions.proceedFromFulfillmentDetails,
    proceedFromShipmentMethod: shipmentActions.proceedFromShipmentMethod,
    providerBookingAvailable,
    providerLabel: effectiveProviderLabel,
    recordPaymentMutation,
    requiresShipmentDetails,
    shipOnCreditMutation,
    shippingColor,
    shippingConfig,
    showPostShipmentActions,
    sourceInfo,
    updateFulfillmentDetails,
  };
}
