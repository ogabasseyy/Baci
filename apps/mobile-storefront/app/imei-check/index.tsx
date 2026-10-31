import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Pressable, View } from 'react-native';
import { ImeiCheckPager } from '@/components/imei-check/ImeiCheckPager';
import { ImeiDeviceTabs } from '@/components/imei-check/ImeiDeviceTabs';
import HeroCard from '@/components/imei-check/imei-check-hero-card';
import { ImeiCheckPending } from '@/components/imei-check/imei-check-pending';
import { ImeiCheckResultView } from '@/components/imei-check/imei-check-result-view';
import { imeiCheckScreenActions } from '@/components/imei-check/imei-check-screen-actions';
import { ImeiReportHistory } from '@/components/imei-check/imei-report-history';
import { useImeiCheckFlow } from '@/components/imei-check/use-imei-check-flow';
import { useImeiDeviceNavigation } from '@/components/imei-check/use-imei-device-navigation';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import { resolveStorefrontApiBaseUrl } from '@/lib/storefront-api-url';

const API_BASE_URL = resolveStorefrontApiBaseUrl(
  process.env.EXPO_PUBLIC_STOREFRONT_API_URL,
  process.env.EXPO_PUBLIC_API_URL
);
export default function ImeiCheckerScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    deviceOrder,
    handleDeviceTab,
    handlePageSelected,
    pagerRef,
    selectedDevice,
    visitedDevices,
  } = useImeiDeviceNavigation(() => {
    /* UI handlers clear errors after the flow hook is available. */
  });
  const {
    error,
    isLoading,
    result,
    resultDevice,
    resultLookupId,
    resultTier,
    session,
    customerId,
    merchantId,
    pendingLookup,
    walletQuery,
    walletBalance,
    handleVerify,
    handleReset,
    openReport,
    clearError,
  } = useImeiCheckFlow(selectedDevice, API_BASE_URL);
  usePreventRemove(result !== null, () => {
    if (isLoading || pendingLookup.pending) return;
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

      <ImeiReportHistory
        colors={colors}
        apiBaseUrl={API_BASE_URL}
        accessToken={session?.access_token}
        scope={`${merchantId}:${customerId}:${session?.user?.id ?? ''}`}
        disabled={isLoading || pendingLookup.pending !== null}
        onOpen={openReport}
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
          isChecking={isLoading || pendingLookup.pending !== null}
          pendingPaused={pendingLookup.paused}
          canResume={pendingLookup.canResume}
          checkError={error}
          onCheckBlacklist={
            resultDevice === 'smartphone'
              ? () => {
                  void handleVerify(
                    'blacklist',
                    result.imei,
                    'smartphone',
                    true
                  );
                }
              : undefined
          }
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
              onSelect={(device) => {
                clearError();
                handleDeviceTab(device);
              }}
            />
          </View>
          {pendingLookup.pending ? (
            <ImeiCheckPending
              colors={colors}
              paused={pendingLookup.paused}
              canResume={pendingLookup.canResume}
            />
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
            onPageSelected={(event) => {
              clearError();
              handlePageSelected(event);
            }}
            onVerify={handleVerify}
            onTopUpWallet={imeiCheckScreenActions.fundWallet}
          />
        </AppKeyboardContainer>
      )}
    </StorefrontScreenShell>
  );
}
