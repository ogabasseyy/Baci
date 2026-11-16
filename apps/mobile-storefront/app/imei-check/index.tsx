import { IMEI_SERVICE_TIERS, resolveImeiReportDevice } from '@baci/shared/imei';
import { ImeiCheckPager } from '@/components/imei-check/ImeiCheckPager';
import { ImeiCheckPending } from '@/components/imei-check/imei-check-pending';
import { ImeiCheckResultView } from '@/components/imei-check/imei-check-result-view';
import { ImeiCheckScreenHeader } from '@/components/imei-check/imei-check-screen-header';
import { ImeiCheckTop } from '@/components/imei-check/imei-check-top';
import { ImeiReportHistory } from '@/components/imei-check/imei-report-history';
import { useImeiCheckFlow } from '@/components/imei-check/use-imei-check-flow';
import { useImeiDeviceNavigation } from '@/components/imei-check/use-imei-device-navigation';
import { useImeiScreenNavigationGuards } from '@/components/imei-check/use-imei-screen-navigation-guards';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import { useColorScheme } from '@/components/useColorScheme';
import { WalletPaySheet } from '@/components/wallet-pay/WalletPaySheet';
import Colors from '@/constants/Colors';
import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
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
    walletPay,
    walletQuery,
    walletBalance,
    walletIsStoreCredit,
    fundWallet,
    handleVerify,
    handleReset,
    openReport,
    clearError,
    dropInvalidIdentifierError,
  } = useImeiCheckFlow(selectedDevice, API_BASE_URL);
  // Same rule as fundWallet: not ruled out means a card-only top-up.
  const topUpCardOnly = usePiggyvestCapabilityNow(merchantId) !== false;
  const busy = isLoading || pendingLookup.pending !== null;
  useImeiScreenNavigationGuards(walletPay.sheet, result !== null, handleReset);

  return (
    <StorefrontScreenShell
      edges={['left', 'right']}
      style={{ backgroundColor: colors.background }}
    >
      <ImeiCheckScreenHeader
        step={result ? 'report' : 'pick'}
        textColor={colors.text}
        onBackFromReport={handleReset}
      />
      <WalletPaySheet colors={colors} {...walletPay.sheetProps} />

      {result ? (
        <ImeiCheckResultView
          accessToken={session?.access_token}
          apiBaseUrl={API_BASE_URL}
          colors={colors}
          currentTier={IMEI_SERVICE_TIERS[resultTier]}
          lookupId={resultLookupId}
          result={result}
          onReset={handleReset}
          isChecking={busy}
          pendingPaused={pendingLookup.paused}
          canResume={pendingLookup.canResume}
          checkError={error}
          onCheckBlacklist={
            resultDevice === 'smartphone' && selectedDevice === 'smartphone'
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
          <ImeiCheckTop
            colors={colors}
            selected={selectedDevice}
            onSelect={(device) => {
              clearError();
              handleDeviceTab(device);
            }}
          />
          <ImeiReportHistory
            colors={colors}
            apiBaseUrl={API_BASE_URL}
            accessToken={session?.access_token}
            scope={`${merchantId}:${customerId}:${session?.user?.id ?? ''}`}
            disabled={busy}
            onOpen={(report, listedFor) => {
              // The device tab follows the report, so a follow-up check (and its
              // PiggyVest key) is made for that report's device.
              const device = resolveImeiReportDevice(
                report.tier,
                report.device
              );
              if (device) handleDeviceTab(device);
              openReport(report, listedFor);
            }}
          />
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
            isLoading={busy}
            isWalletError={Boolean(walletQuery.isError)}
            isWalletLoading={Boolean(walletQuery.isLoading)}
            pagerRef={pagerRef}
            visitedDevices={visitedDevices}
            walletBalance={walletBalance}
            walletIsStoreCredit={walletIsStoreCredit}
            walletPay={walletPay.view}
            topUpCardOnly={topUpCardOnly}
            onPageSelected={(event) => {
              clearError();
              handlePageSelected(event);
            }}
            onVerify={handleVerify}
            onEditIdentifier={dropInvalidIdentifierError}
            onTopUpWallet={fundWallet}
          />
        </AppKeyboardContainer>
      )}
    </StorefrontScreenShell>
  );
}
