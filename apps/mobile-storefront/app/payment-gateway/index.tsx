/**
 * Payment Gateway WebView Screen
 * Handles card payment checkout via Paystack, Korapay, and Juicyway
 */

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { useAuthStore } from '@/stores/auth-store';

export default function PaymentGatewayScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const controller = usePaymentGatewayController();
  const user = useAuthStore((state) => state.user);
  const customer = useAuthStore((state) => state.customer);
  const paramsData = controller.validatedParams.data;
  // Deep-link params are caller-controlled: the stamp alone proves
  // nothing, and the reference alone does not bind the payment (a
  // caller knowing it could pair it with any live Paystack URL). Every
  // primary launch resolves ownership from the device record, then
  // recovers the operation from the server and requires the exact
  // server-issued checkout URL and amount. The WebView stays unmounted
  // until both proofs pass (or the launch is blocked).
  const needsOwnershipCheck =
    controller.validatedParams.isValid &&
    controller.paymentKind === 'primary_wallet_card';
  const [ownership, setOwnership] = useState<
    'pending' | 'verified' | 'blocked' | 'mismatch'
  >('pending');
  useEffect(() => {
    if (!needsOwnershipCheck) return;
    let cancelled = false;
    setOwnership('pending');
    (async () => {
      const client = createPrimaryWalletCardFundingClient();
      let record: Awaited<ReturnType<typeof client.readPending>>;
      try {
        record = await client.readPending({
          merchantId: paramsData?.merchantId,
          userId: user?.id,
        });
      } catch {
        if (!cancelled) setOwnership('blocked');
        return;
      }
      if (
        record == null ||
        record.operationId == null ||
        `pvb-first-primary-${record.operationId}` !== paramsData?.reference
      ) {
        if (!cancelled) setOwnership('blocked');
        return;
      }
      // Server bind: recover() status-polls the record's operation
      // (never re-initializes: operationId is non-null here) and
      // already enforces the record amount. Mount only when the
      // server confirms this exact checkout URL and amount — a stale
      // URL for an advanced operation, a forged URL, a tampered
      // amount, or an unreachable server all fail closed. The WebView
      // needs network regardless, so offline has no legitimate mount.
      try {
        const status = await client.recover({
          merchantId: record.merchantId,
          userId: record.userId,
          reference: paramsData?.reference,
        });
        const bound =
          status.authorizationUrl === paramsData?.authorizationUrl &&
          typeof paramsData?.amount === 'number' &&
          Math.round(paramsData.amount * 100) === status.amountKobo;
        if (!cancelled) setOwnership(bound ? 'verified' : 'mismatch');
      } catch {
        if (!cancelled) setOwnership('mismatch');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    needsOwnershipCheck,
    paramsData?.merchantId,
    paramsData?.reference,
    paramsData?.authorizationUrl,
    paramsData?.amount,
    user?.id,
  ]);

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
    if (
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
      // operation.
      if (ownership === 'blocked' || ownership === 'mismatch') {
        return (
          <PrimaryWalletCardPendingView
            colors={colors}
            statusError
            message={null}
            terminalDirective={
              ownership === 'blocked'
                ? 'We could not find this funding for this account on this device. Return to your wallet to start a new funding — any completed checkout will still be found and credited.'
                : 'We could not confirm this checkout for your pending funding. Return to your wallet to check its status — do not start another charge if you already paid.'
            }
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
