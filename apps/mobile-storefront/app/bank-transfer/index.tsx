import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { BankTransferView } from '@/components/bank-transfer/BankTransferView';
import { validateBankTransferParams } from '@/components/bank-transfer/validate-bank-transfer-params';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { WALLET_FUNDING_POLLING } from '@/constants/wallet-funding';
import { useWalletFundingPolling } from '@/hooks/use-wallet-funding-polling';
import { setClipboardString } from '@/lib/clipboard';
import type { WalletOrderFundingIntent } from '@/lib/order-wallet-funding-intent';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import { resolveWalletFundedTotal } from './wallet-funded-total';

const copyToClipboard = async (text: string) => {
  return await setClipboardString(text);
};

const HEADER_CLOSE_STYLE = { padding: 8 } as const;

const handleClose = (): void => {
  Alert.alert(
    'Leave Payment?',
    'Your order has been created. You can complete payment later using the account details sent to your email.',
    [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => router.back(),
      },
    ]
  );
};

function getWalletFundedRemainingAmount(
  intent: WalletOrderFundingIntent | null
) {
  if (!intent) return undefined;
  if (typeof intent.remainingAmount === 'number') {
    return intent.remainingAmount;
  }
  return Math.max(intent.expectedAmount - intent.fundedAmount, 0);
}

export default function BankTransferScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const params = useLocalSearchParams<Record<string, string>>();
  const clearCart = useCartStore((state) => state.clearCart);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isLegacySubmitting, setIsLegacySubmitting] = useState(false);

  const validatedParams = validateBankTransferParams(params);
  const routeData = validatedParams.data;
  const legacyRouteData =
    validatedParams.isValid && validatedParams.mode === 'legacy'
      ? validatedParams.data
      : null;
  const walletRouteData =
    validatedParams.isValid && validatedParams.mode === 'wallet_funded'
      ? validatedParams.data
      : null;
  const {
    orderId,
    orderNumber,
    amount,
    orderTotal,
    bankName,
    accountNumber,
    accountName,
    trackingToken,
  } = routeData ?? {};
  // Checkout attribution snapshot threaded through the wallet-funded route
  // (see checkout-wallet-funded-bank-transfer): the completion below wins
  // the durable claim, and the success screen cannot enrich it afterwards.
  const {
    customerEmail: routeCustomerEmail,
    customerPhone: routeCustomerPhone,
    subtotal: routeSubtotal,
    shipping: routeShipping,
    tax: routeTax,
  } = walletRouteData ?? {};
  const intentId = walletRouteData?.intentId;
  const merchantId = walletRouteData?.merchantId;
  const merchantSlug = walletRouteData?.merchantSlug;
  const isWalletFunded = validatedParams.mode === 'wallet_funded';

  const routeToOrderSuccess = async ({
    successReference,
  }: {
    successReference?: string;
  }) => {
    await clearCart();
    try {
      const persistOpts = useCartStore.persist.getOptions();
      const partialize = persistOpts.partialize ?? ((state: unknown) => state);
      const persistedState = partialize(useCartStore.getState());
      const persistClearedCart = persistOpts.storage?.setItem(
        persistOpts.name ?? 'cart-storage',
        {
          state: persistedState,
          version: persistOpts.version ?? 0,
        }
      );
      void Promise.resolve(persistClearedCart).catch((error) => {
        console.warn(
          '[BankTransfer] Failed to persist cleared cart before success redirect',
          error
        );
      });
    } catch (error) {
      console.warn(
        '[BankTransfer] Failed to persist cleared cart before success redirect',
        error
      );
    }
    router.replace({
      pathname: '/order-success',
      params: {
        orderId,
        orderNumber: orderNumber || '',
        paymentMethod: 'bank_transfer',
        ...(successReference ? { reference: successReference } : {}),
        ...(trackingToken && { trackingToken }),
      },
    });
  };

  const walletFundingPolling = useWalletFundingPolling({
    enabled: validatedParams.isValid && isWalletFunded && Boolean(intentId),
    intentId,
    merchantId,
    merchantSlug,
    onCompleted: (intent) => {
      // The funding intent is confirmed: record the conversion before the
      // success route clears the cart (purchase capture needs cart items).
      if (orderId) {
        // Canonical full order value (single-source helper): the routed
        // total wins over the post-savings intent residual.
        const fundedTotal = resolveWalletFundedTotal({
          orderTotal,
          targetOrderAmount: intent.targetOrderAmount,
          amount,
        });
        // First completion wins the durable claim; replays emit nothing.
        // Snapshot the cart synchronously: the claim await below yields,
        // and the success route may clear the cart before it resolves.
        void trackCheckoutPaymentCompletedOnce({
          ...(routeCustomerEmail && { customerEmail: routeCustomerEmail }),
          ...(routeCustomerPhone && { customerPhone: routeCustomerPhone }),
          items: useCartStore.getState().items,
          orderId,
          orderNumber: orderNumber || orderId,
          paymentMethod: 'bank_transfer',
          reference: intent.id,
          ...(routeShipping !== undefined && { shipping: routeShipping }),
          ...(routeSubtotal !== undefined && { subtotal: routeSubtotal }),
          ...(routeTax !== undefined && { tax: routeTax }),
          value: fundedTotal,
        });
      }
      void routeToOrderSuccess({ successReference: intent.id });
    },
    onError: () => {
      Alert.alert(
        'Unable to check payment status',
        'Please try again in a moment.'
      );
    },
    pollIntervalMs: WALLET_FUNDING_POLLING.INTERVAL_MS,
    timeoutMs: WALLET_FUNDING_POLLING.TIMEOUT_MS,
  });
  const isSubmitting = isWalletFunded
    ? walletFundingPolling.isPolling
    : isLegacySubmitting;

  const handleCopy = async (text: string, field: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } else {
      // Optional: show toast or alert if copy fails
    }
  };
  const handleCopyIfPresent = (text: string | undefined, field: string) => {
    const trimmedText = text?.trim();
    if (!trimmedText) return;
    void handleCopy(trimmedText, field);
  };

  const handleConfirmTransfer = () => {
    if (isSubmitting) return;
    if (isWalletFunded) {
      void walletFundingPolling.checkNow({ notifyOnError: true });
      return;
    }
    setIsLegacySubmitting(true);
    // The legacy DVA route requires the provider reference: forward it so
    // the deferred settlement capture can reconcile the conversion,
    // mirroring the wallet-funded intent-id handoff.
    void routeToOrderSuccess({
      successReference: legacyRouteData?.reference,
    });
  };

  return (
    <>
      <Stack.Screen
        options={
          validatedParams.isValid
            ? {
                title: 'Bank Transfer',
                headerShown: true,
                headerLeft: () => (
                  <Pressable
                    accessibilityLabel="Close bank transfer"
                    accessibilityRole="button"
                    onPress={handleClose}
                    style={HEADER_CLOSE_STYLE}
                  >
                    <Ionicons name="close" size={24} color={colors.text} />
                  </Pressable>
                ),
              }
            : { headerShown: false }
        }
      />
      <BankTransferView
        accountName={accountName}
        accountNumber={accountNumber}
        amount={amount}
        bankName={bankName}
        colors={colors}
        copiedField={copiedField}
        error={validatedParams.error}
        isSubmitting={isSubmitting}
        isValid={validatedParams.isValid}
        mode={validatedParams.mode}
        onBack={() => router.back()}
        onConfirmTransfer={handleConfirmTransfer}
        onCopyAccountName={() => handleCopyIfPresent(accountName, 'name')}
        onCopyAccountNumber={() =>
          handleCopyIfPresent(accountNumber, 'account')
        }
        onCopyBankName={() => handleCopyIfPresent(bankName, 'bank')}
        orderNumber={orderNumber}
        pollingTimedOut={walletFundingPolling.timedOut}
        remainingAmount={getWalletFundedRemainingAmount(
          walletFundingPolling.intent
        )}
        walletFundingStatus={walletFundingPolling.intent?.status}
      />
    </>
  );
}
