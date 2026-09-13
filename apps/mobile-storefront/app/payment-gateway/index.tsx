/**
 * Payment Gateway WebView Screen
 * Handles card payment checkout via Paystack, Korapay, and Juicyway
 */

import { InvalidCheckoutView } from '@/components/payment-gateway/InvalidCheckoutView';
import { PaymentErrorView } from '@/components/payment-gateway/PaymentErrorView';
import { PaymentGatewayCheckoutView } from '@/components/payment-gateway/PaymentGatewayCheckoutView';
import { PaymentProcessingView } from '@/components/payment-gateway/PaymentProcessingView';
import { PaymentSuccessView } from '@/components/payment-gateway/PaymentSuccessView';
import { RedvaultPendingView } from '@/components/payment-gateway/RedvaultPendingView';
import { usePaymentGatewayController } from '@/components/payment-gateway/use-payment-gateway-controller';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function PaymentGatewayScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const controller = usePaymentGatewayController();

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
          onBack={controller.handleBack}
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
