import {
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Crypto from 'expo-crypto';
import { router, Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useEffectEvent, useState } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import { ImeiCheckPager } from '@/components/imei-check/ImeiCheckPager';
import { ImeiDeviceTabs } from '@/components/imei-check/ImeiDeviceTabs';
import HeroCard from '@/components/imei-check/imei-check-hero-card';
import { ImeiCheckPending } from '@/components/imei-check/imei-check-pending';
import { ImeiCheckResultView } from '@/components/imei-check/imei-check-result-view';
import { imeiCheckScreenActions } from '@/components/imei-check/imei-check-screen-actions';
import { getImeiWalletCopy } from '@/components/imei-check/imei-wallet-copy';
import { resolveImeiCheckFailure } from '@/components/imei-check/resolve-imei-check-failure';
import { submitImeiCheck } from '@/components/imei-check/submit-imei-check';
import { useImeiDeviceNavigation } from '@/components/imei-check/use-imei-device-navigation';
import { useImeiPendingLookup } from '@/components/imei-check/use-imei-pending-lookup';
import { useImeiRequestIdentity } from '@/components/imei-check/use-imei-request-identity';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import { useCardOnlyPurchaseTopUp } from '@/hooks/use-card-only-purchase-top-up';
import { useWallet } from '@/hooks/use-wallet';
import { createLogger } from '@/lib/logger';
import { resolveStorefrontApiBaseUrl } from '@/lib/storefront-api-url';
import {
  ImeiCheckApiResponseSchema,
  type ImeiResult,
  parseApiResponse,
} from '@/lib/validation';
import { isWalletStoreCredit } from '@/lib/wallet-store-credit';
import { useAuthStore } from '@/stores/auth-store';

const log = createLogger('ImeiChecker');
const API_BASE_URL = resolveStorefrontApiBaseUrl(
  process.env.EXPO_PUBLIC_STOREFRONT_API_URL,
  process.env.EXPO_PUBLIC_API_URL
);

export default function ImeiCheckerScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImeiResult | null>(null);
  const [resultLookupId, setResultLookupId] = useState<string | null>(null);
  const [resultTier, setResultTier] = useState<ImeiServiceTierKey>('full');
  const [error, setError] = useState<string | null>(null);
  const {
    deviceOrder,
    handleDeviceTab,
    handlePageSelected,
    pagerRef,
    selectedDevice,
    visitedDevices,
  } = useImeiDeviceNavigation(() => setError(null));
  const session = useAuthStore((state) => state.session);
  const customerId = useAuthStore((state) => state.customer?.id);
  const merchantId = useAuthStore((state) => state.merchantId ?? undefined);
  const walletQuery = useWallet();
  const pendingLookup = useImeiPendingLookup({
    accessToken: session?.access_token,
    apiBaseUrl: API_BASE_URL,
    customerId,
    merchantId,
  });
  const requestIdentity = useImeiRequestIdentity(Crypto.randomUUID);

  // Checks spend the older balance: store credit for PiggyVest customers.
  const walletBalance = walletQuery.data?.wallet.balance ?? 0;
  const walletIsStoreCredit = isWalletStoreCredit(walletQuery.data?.wallet);
  const walletCopy = getImeiWalletCopy(walletIsStoreCredit);
  const cardOnlyTopUp = useCardOnlyPurchaseTopUp(
    merchantId,
    walletQuery.data?.wallet
  );
  const fundWallet = (amount: number) =>
    imeiCheckScreenActions.fundWallet(amount, cardOnlyTopUp);

  const clearIdempotencyKey = () => {
    requestIdentity.clear();
  };

  const handlePendingTerminal = useEffectEvent(
    (terminal: NonNullable<typeof pendingLookup.terminal>) => {
      clearIdempotencyKey();
      setIsLoading(false);
      if (terminal.kind === 'complete') {
        setError(null);
        setResultTier(terminal.tier);
        setResultLookupId(terminal.lookupId);
        setResult(terminal.result);
      } else {
        setError(terminal.error);
      }
      pendingLookup.clearTerminal();
    }
  );

  useEffect(() => {
    if (pendingLookup.terminal) {
      handlePendingTerminal(pendingLookup.terminal);
    }
  }, [pendingLookup.terminal]);

  const handleVerify = async (tier: ImeiServiceTierKey, imei: string) => {
    Keyboard.dismiss();
    if (isLoading || pendingLookup.pending) return;

    const serviceTier = IMEI_SERVICE_TIERS[tier];
    if (!isValidDeviceIdentifier(imei, serviceTier.identifier)) {
      imeiCheckScreenActions.alertInvalidIdentifier(serviceTier.identifier);
      return;
    }

    if (walletQuery.isLoading) {
      setError(`${walletCopy.loading} Please try again in a moment.`);
      return;
    }
    if (walletQuery.isError) {
      setError(walletCopy.unavailable);
      return;
    }
    if (walletBalance < serviceTier.price) {
      fundWallet(serviceTier.price - walletBalance);
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    const idempotencyKey = requestIdentity.get(tier, imei);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const performCheck = async () => {
      const { rawData, response } = await submitImeiCheck({
        accessToken: session?.access_token,
        apiBaseUrl: API_BASE_URL,
        device: selectedDevice,
        idempotencyKey,
        identifier: imei,
        signal: controller.signal,
        tier,
      });
      if (!response.ok || rawData?.error) {
        const outcome = resolveImeiCheckFailure({
          currentTierPrice: serviceTier.price,
          payload: rawData,
          responseStatus: response.status,
          walletBalance,
        });

        if (outcome.shouldClearIdempotencyKey) {
          clearIdempotencyKey();
        }
        if (outcome.shouldRedirectToLogin) {
          router.push('/auth/login?returnTo=/imei-check');
          return;
        }
        if (outcome.topUpAmount !== null) {
          fundWallet(outcome.topUpAmount);
          return;
        }
        if (outcome.shouldRefetchWallet) {
          await walletQuery.refetch?.();
        }
        if (outcome.errorMessage) {
          setError(outcome.errorMessage);
        }
        return;
      }

      const validated = parseApiResponse(
        ImeiCheckApiResponseSchema,
        rawData,
        'IMEI check API'
      );
      if (
        validated?.success &&
        validated.status === 'pending' &&
        validated.lookupId
      ) {
        await pendingLookup.start({
          lookupId: validated.lookupId,
          pollAfterMs: validated.pollAfterMs ?? 2_000,
          tier,
        });
        return;
      }
      if (!validated?.success || !validated.data) {
        clearIdempotencyKey();
        setError('Invalid response from server. Please try again.');
        return;
      }

      clearIdempotencyKey();
      setResultTier(tier);
      setResultLookupId(validated.lookupId ?? null);
      setResult(validated.data);
    };

    await performCheck()
      .catch((err: unknown) => {
        log.error('IMEI check failed:', err);
        setError(imeiCheckScreenActions.networkErrorMessage(err));
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setIsLoading(false);
      });
  };

  const handleReset = () => {
    clearIdempotencyKey();
    void pendingLookup.clear();
    setResult(null);
    setResultLookupId(null);
    setError(null);
  };

  usePreventRemove(result !== null, () => {
    handleReset();
  });

  return (
    <StorefrontScreenShell
      edges={['left', 'right']}
      style={{ backgroundColor: colors.background }}
    >
      <Stack.Screen
        options={{
          title: 'IMEI Checker',
          headerLeft: () => (
            <Pressable
              accessibilityHint="Returns to the previous screen"
              accessibilityLabel="Back"
              accessibilityRole="button"
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      {result ? (
        <ImeiCheckResultView
          accessToken={session?.access_token}
          apiBaseUrl={API_BASE_URL}
          colors={colors}
          currentTier={IMEI_SERVICE_TIERS[resultTier]}
          lookupId={resultLookupId}
          result={result}
          onReset={handleReset}
        />
      ) : (
        <AppKeyboardContainer style={{ flex: 1 }}>
          <View
            style={{
              paddingHorizontal: SPACING.md,
              paddingTop: SPACING.sm,
            }}
          >
            <HeroCard colors={colors} />
            <ImeiDeviceTabs
              colors={colors}
              selected={selectedDevice}
              onSelect={handleDeviceTab}
            />
          </View>
          {pendingLookup.pending ? (
            <ImeiCheckPending colors={colors} paused={pendingLookup.paused} />
          ) : null}
          <ImeiCheckPager
            colors={colors}
            error={error}
            initialPage={deviceOrder.indexOf(selectedDevice)}
            isLoading={isLoading || pendingLookup.pending !== null}
            isWalletError={Boolean(walletQuery.isError)}
            isWalletLoading={Boolean(walletQuery.isLoading)}
            pagerRef={pagerRef}
            visitedDevices={visitedDevices}
            walletBalance={walletBalance}
            walletIsStoreCredit={walletIsStoreCredit}
            onPageSelected={handlePageSelected}
            onVerify={handleVerify}
            onTopUpWallet={fundWallet}
          />
        </AppKeyboardContainer>
      )}
    </StorefrontScreenShell>
  );
}
