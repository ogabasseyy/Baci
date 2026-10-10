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
import { PrimaryWalletCardPendingView } from '@/components/payment-gateway/PrimaryWalletCardPendingView';
import { getWalletReturnHref } from '@/components/payment-gateway/payment-gateway-controller.helpers';
import { RedvaultPendingView } from '@/components/payment-gateway/RedvaultPendingView';
import { resolvePendingOrdersRoute } from '@/components/payment-gateway/resolve-pending-orders-route';
import { usePaymentGatewayController } from '@/components/payment-gateway/use-payment-gateway-controller';
import { usePrimaryWalletCardOwnership } from '@/components/payment-gateway/use-primary-wallet-card-ownership';
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
  const authReady = useAuthStore((state) => state.isInitialized);
  const paramsData = controller.validatedParams.data;
  const needsOwnershipCheck =
    controller.validatedParams.isValid &&
    controller.paymentKind === 'primary_wallet_card';
  // Mount gate: the WebView stays unmounted until the device record
  // plus server URL/amount bind both pass (or the launch is blocked).
  const { ownership, retryBind } = usePrimaryWalletCardOwnership({
    enabled: needsOwnershipCheck,
    authReady,
    userId: user?.id,
    merchantId: paramsData?.merchantId,
    reference: paramsData?.reference,
    authorizationUrl: paramsData?.authorizationUrl,
    amount: paramsData?.amount,
  });

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

    // Post-navigation account switch: the fund flow stamps the guarded
    // user into the launch params, but the mounted screen keeps that
    // user's authorization URL and reference. When the active identity no
    // longer matches the stamp, block the whole primary screen — WebView
    // included — instead of letting another user enter card details into
    // the previous account's charge. The operation stays saved for its
    // owner; going back returns to this device's wallet. This stamp
    // comparison is only a fast path for account switches — the
    // persisted-record check below is the authority for every launch.
    // Gated on auth hydration: an unresolved user must not flash the
    // account-changed dead end on a legitimate checkout.
    if (
      authReady &&
      controller.paymentKind === 'primary_wallet_card' &&
      controller.validatedParams.data?.userId &&
      user?.id !== controller.validatedParams.data.userId
    ) {
      // No status check here: the non-owner's tap could only run a
      // doomed check against another account's operation. Only the way
      // back stays available.
      return (
        <PrimaryWalletCardPendingView
          colors={colors}
          statusError
          message={null}
          terminalDirective="Signed-in account changed. This checkout belongs to the previous account — go back so its owner can complete it."
          onBack={() =>
            router.replace(getWalletReturnHref(controller.returnTo))
          }
        />
      );
    }

    // Params carry no trustworthy identity, so the device record is
    // the authority: the WebView mounts only for a record that proves
    // the current user owns this reference.
    if (needsOwnershipCheck) {
      if (ownership === 'pending') {
        return (
          <PaymentProcessingView
            colors={colors}
            paymentKind={controller.paymentKind}
            utilityType={controller.utilityType}
          />
        );
      }
      // Blocked: no device record owns this reference. Mismatch: the
      // record owns it, but the server would not confirm this exact
      // checkout URL and amount — a forged or stale link, or an
      // unreachable server. Never mount the WebView on unconfirmed
      // payment bytes; the wallet fund action resumes the true pending
      // operation. Mismatch offers a re-check: the bind is read-only,
      // so retrying a transient network failure is safe, and a forged
      // link simply fails the bind again.
      if (ownership === 'blocked' || ownership === 'mismatch') {
        return (
          <PrimaryWalletCardPendingView
            colors={colors}
            statusError
            message={null}
            terminalDirective={
              ownership === 'blocked'
                ? 'We could not find this funding for this account on this device. Return to your wallet to start a new funding — any completed checkout will still be found and credited.'
                : 'We could not confirm this checkout for your pending funding. Check your connection and try again, or return to your wallet to check its status — do not start another charge if you already paid.'
            }
            onCheck={ownership === 'mismatch' ? retryBind : undefined}
            onBack={() =>
              router.replace(getWalletReturnHref(controller.returnTo))
            }
          />
        );
      }
    }

    // Closed primary status set: beginPrimaryWalletCardCompletion only
    // emits processing/pending/error/success. 'loading'/'ready' fall
    // through to the Paystack checkout WebView below by design (the
    // authorization URL rides in the navigation params); 'processing'
    // shows the generic spinner and 'success' the generic success view.
    // Every other status — 'held' today, any future status tomorrow —
    // fails closed to primary funding copy here instead of leaking
    // into generic Redvault views.
    if (
      controller.paymentKind === 'primary_wallet_card' &&
      controller.status !== 'loading' &&
      controller.status !== 'ready' &&
      controller.status !== 'processing' &&
      controller.status !== 'success'
    ) {
      return (
        <PrimaryWalletCardPendingView
          colors={colors}
          statusError={controller.status === 'error'}
          message={controller.errorMessage}
          operationReference={
            controller.confirmedOperationReference ?? undefined
          }
          terminalDirective={controller.terminalDirective}
          onCheck={controller.handleRetry}
          onBack={() =>
            router.replace(getWalletReturnHref(controller.returnTo))
          }
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
        missingUrlMessage={
          controller.paymentKind === 'primary_wallet_card'
            ? 'Your funding is saved. Go back and check its status — do not start another charge.'
            : undefined
        }
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
