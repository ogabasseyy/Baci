/**
 * Payment Gateway WebView Screen
 * Handles card payment checkout via Paystack, Korapay, and Juicyway
 */

import { router } from 'expo-router';
import { InvalidCheckoutView } from '@/components/payment-gateway/InvalidCheckoutView';
import { PaymentErrorView } from '@/components/payment-gateway/PaymentErrorView';
import { PaymentGatewayCheckoutView } from '@/components/payment-gateway/PaymentGatewayCheckoutView';
import { PaymentProcessingView } from '@/components/payment-gateway/PaymentProcessingView';
import { PaymentSuccessView } from '@/components/payment-gateway/PaymentSuccessView';
import { RedvaultPendingView } from '@/components/payment-gateway/RedvaultPendingView';
import { resolvePendingOrdersRoute } from '@/components/payment-gateway/resolve-pending-orders-route';
import { usePaymentGatewayController } from '@/components/payment-gateway/use-payment-gateway-controller';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuthStore } from '@/stores/auth-store';

export default function PaymentGatewayScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const controller = usePaymentGatewayController();
  const user = useAuthStore((state) => state.user);
  const customer = useAuthStore((state) => state.customer);

  // A pending/held REDVAULT capture may still be reconciled server-side, so
  // this action must not return to the still-populated checkout (which would
  // allow submitting the same cart again). Route to the order status view.
  const handlePendingOrders = () => {
    router.replace(
      resolvePendingOrdersRoute({
        customerId: customer?.id,
        orderId: controller.validatedParams.data?.orderId,
        trackingToken: controller.validatedParams.data?.trackingToken,
        userId: user?.id,
      })
    );
  };

  const renderPaymentContent = () => {
    if (!controller.validatedParams.isValid) {
      return (
        <InvalidCheckoutView
          colors={colors}
          error={controller.validatedParams.error}
          onBack={controller.handleBack}
        />
      );
    }

    if (controller.status === 'pending' || controller.status === 'held') {
      return (
        <RedvaultPendingView
          colors={colors}
          held={controller.status === 'held'}
          onCheck={controller.handleRetry}
          onViewOrders={handlePendingOrders}
        />
      );
    }
    if (controller.status === 'processing') {
      return (
        <PaymentProcessingView
          colors={colors}
          paymentKind={controller.paymentKind}
          utilityType={controller.utilityType}
        />
      );
    }

    if (controller.status === 'success') {
      return (
        <PaymentSuccessView
          colors={colors}
          paymentKind={controller.paymentKind}
        />
      );
    }

    if (controller.status === 'error') {
      return (
        <PaymentErrorView
          colors={colors}
          errorMessage={controller.errorMessage}
          gatewayName={controller.gatewayName}
          onBack={controller.handleBack}
          onRetry={controller.handleRetry}
        />
      );
    }

    return (
      <PaymentGatewayCheckoutView
        amount={controller.amount}
        authorizationUrl={controller.authorizationUrl}
        colors={colors}
        gatewayName={controller.gatewayName}
        onClose={controller.handleClose}
        onError={controller.handleWebViewError}
        onLoadEnd={controller.handleLoadEnd}
        onLoadStart={controller.handleLoadStart}
        onMessage={controller.handleWebViewMessage}
        onNavigationStateChange={controller.handleNavigationChange}
        onShouldStartLoadWithRequest={
          controller.handleShouldStartLoadWithRequest
        }
        status={controller.status}
        ToastComponent={controller.toast.Toast}
        webViewRef={controller.webViewRef}
      />
    );
  };

  return (
    <StorefrontScreenShell style={{ backgroundColor: colors.background }}>
      {renderPaymentContent()}
    </StorefrontScreenShell>
  );
}
