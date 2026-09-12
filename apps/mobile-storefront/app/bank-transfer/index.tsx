import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { BankTransferView } from '@/components/bank-transfer/BankTransferView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { WALLET_FUNDING_POLLING } from '@/constants/wallet-funding';
import { useWalletFundingPolling } from '@/hooks/use-wallet-funding-polling';
import { setClipboardString } from '@/lib/clipboard';
import type { WalletOrderFundingIntent } from '@/lib/order-wallet-funding-intent';
import {
  type BankTransferParams,
  BankTransferParamsSchema,
  type WalletFundedBankTransferParams,
  WalletFundedBankTransferParamsSchema,
} from '@/schemas/bank-transfer-params';
import { useCartStore } from '@/stores/cart-store';

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

type ValidatedBankTransferParams =
  | {
      data: BankTransferParams;
      error: null;
      isValid: true;
      mode: 'legacy';
    }
  | {
      data: WalletFundedBankTransferParams;
      error: null;
      isValid: true;
      mode: 'wallet_funded';
    }
  | {
      data: null;
      error: string;
      isValid: false;
      mode: 'legacy' | 'wallet_funded';
    };

function validateBankTransferParams(
  params: Record<string, string>
): ValidatedBankTransferParams {
  // `intentId` is a legacy deep-link fallback; an explicit walletFunded flag wins.
  const isWalletFunded =
    params.walletFunded === 'true' ||
    (params.walletFunded === undefined && Boolean(params.intentId));
  if (isWalletFunded) {
    const result = WalletFundedBankTransferParamsSchema.safeParse(params);
    return result.success
      ? {
          data: result.data,
          error: null,
          isValid: true,
          mode: 'wallet_funded' as const,
        }
      : {
          data: null,
          error: result.error.issues[0]?.message || 'Invalid parameters',
          isValid: false,
          mode: 'wallet_funded' as const,
        };
  }
  const result = BankTransferParamsSchema.safeParse(params);
  if (!result.success) {
    return {
      data: null,
      error: result.error.issues[0]?.message || 'Invalid parameters',
      isValid: false,
      mode: 'legacy' as const,
    };
  }
  return {
    data: result.data,
    error: null,
    isValid: true,
    mode: 'legacy',
  };
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
  const walletRouteData =
    validatedParams.isValid && validatedParams.mode === 'wallet_funded'
      ? validatedParams.data
      : null;
  const {
    orderId,
    orderNumber,
    amount,
    bankName,
    accountNumber,
    accountName,
    trackingToken,
  } = routeData ?? {};
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
    void routeToOrderSuccess({});
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
