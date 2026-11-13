import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { useColorScheme } from '@/components/useColorScheme';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { isPiggyvestCardOnlyMerchant } from '@/lib/is-piggyvest-card-only-merchant';
import { isWalletPurchaseReturnHref } from '@/lib/is-wallet-purchase-return-href';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { isWalletSavingsReturnHref } from '@/lib/sanitize-wallet-return-to';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';
import type { WalletContentProps } from './WalletContent';
import { WalletFundPanel } from './WalletFundPanel';
import { useWalletPrimaryReady } from './WalletPrimaryContext';

type WalletFundModalProps = Pick<
  WalletContentProps,
  | 'canCreateFundingAccount'
  | 'colors'
  | 'createFundingAccountUnavailableMessage'
  | 'fundAmount'
  | 'fundingAccount'
  | 'fundReturnTo'
  | 'isCreatingFundingAccount'
  | 'isFundPending'
  | 'needsPhone'
  | 'merchantId'
  | 'onRefresh'
  | 'onChangeFundAmount'
  | 'onConfirmFund'
  | 'onCreateFundingAccount'
  | 'onResetFund'
  | 'onSubmitPhone'
  | 'showFundPanel'
  | 'walletPrimaryUnsettled'
> & { creditWatch: WalletCreditWatch };

export function WalletFundModal({
  canCreateFundingAccount,
  colors,
  createFundingAccountUnavailableMessage,
  creditWatch,
  fundAmount,
  fundingAccount,
  fundReturnTo,
  isCreatingFundingAccount,
  isFundPending,
  needsPhone,
  merchantId,
  onRefresh,
  onChangeFundAmount,
  onConfirmFund,
  onCreateFundingAccount,
  onResetFund,
  onSubmitPhone,
  showFundPanel,
  walletPrimaryUnsettled = false,
}: WalletFundModalProps) {
  const primaryCapability = usePiggyvestPrimaryCapability(merchantId);
  const isDark = useColorScheme() === 'dark';
  // Card top-ups credit the legacy wallet, so only primary-funded flows (a
  // savings shortfall or a plain top-up) lose the card option; any other
  // return flow (e.g. IMEI check) still spends the legacy balance.
  const primaryReady = useWalletPrimaryReady();
  // PiggyVest merchant whose primary wallet the server hasn't ruled out.
  const piggyvestMerchant = isPiggyvestCardOnlyMerchant(
    merchantId,
    primaryCapability
  );
  // A purchase return (IMEI check, utilities) spends store credit, which
  // only a card top-up adds: the PiggyVest account would fund savings.
  // Also when the PiggyVest read is unknown (timed out) or not set up yet,
  // so the purchase never detours into PiggyVest setup.
  // Same rule as the purchase screens (useCardOnlyPurchaseTopUp): an
  // unsettled wallet at a merchant not ruled out is a store credit top-up.
  const storeCreditTopUp =
    isWalletPurchaseReturnHref(fundReturnTo) &&
    (primaryReady ||
      piggyvestMerchant ||
      (walletPrimaryUnsettled && primaryCapability !== false));
  // Every other PiggyVest top-up (plain, savings plan, start savings) funds
  // the savings wallet by bank transfer, never by card.
  const hideCardFunding = primaryReady && !storeCreditTopUp;
  // A store credit top-up opened from a purchase pushes the wallet page;
  // dismissing the sheet returns straight to that purchase instead of
  // leaving the customer on the pushed page (walk-through M8).
  const dismissFund = () => {
    onResetFund();
    if (!storeCreditTopUp || !fundReturnTo) return;
    // A deep link has no history underneath: open the purchase instead.
    if (router.canGoBack()) router.back();
    else router.replace(fundReturnTo);
  };
  // Provisioning is tracked by provider, not by account presence: a retained
  // legacy account must not mask pending primary onboarding, and the legacy
  // details stay resolved (nothing is discarded) for transfer display and
  // fallback once setup completes.
  const showPrimarySetup =
    !storeCreditTopUp &&
    !!merchantId &&
    piggyvestMerchant &&
    fundingAccount?.provider !== 'piggyvest';
  // Keep the panel rendered while the card slides down on close, so the
  // exit animation shows the sheet instead of an empty card; it unmounts
  // (clearing any retained BVN state) once the slide has finished.
  const [retainContent, setRetainContent] = useState(showFundPanel);
  if (showFundPanel && !retainContent) setRetainContent(true);
  return (
    <ModalSheet
      presentation="fade-backdrop"
      backdropStyle={{
        // Soft blue-white wash in light mode; plain dim in dark mode.
        backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(226,232,240,0.72)',
      }}
      cardStyle={{
        backgroundColor: colors.card,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        maxHeight: '90%',
        overflow: 'hidden',
      }}
      keyboardAutomaticOffset
      keyboardSurfaceColor={colors.card}
      visible={showFundPanel}
      onRequestClose={dismissFund}
      onBackdropPress={dismissFund}
      onClosed={() => setRetainContent(false)}
    >
      {showFundPanel || retainContent ? (
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {showPrimarySetup ? (
            <PiggyvestWalletSetupPanel
              colors={colors}
              merchantId={merchantId}
              needsPhone={needsPhone}
              onSubmitPhone={onSubmitPhone}
              onRefresh={onRefresh}
              onClose={onResetFund}
            />
          ) : (
            <WalletFundPanel
              canCreateFundingAccount={canCreateFundingAccount}
              colors={colors}
              createFundingAccountUnavailableMessage={
                createFundingAccountUnavailableMessage
              }
              creditWatch={primaryReady ? undefined : creditWatch}
              fundAmount={fundAmount}
              fundingAccount={fundingAccount}
              hideCardFunding={hideCardFunding}
              isCreatingFundingAccount={isCreatingFundingAccount}
              isFundPending={isFundPending}
              needsPhone={needsPhone}
              onChangeFundAmount={onChangeFundAmount}
              onConfirmFund={onConfirmFund}
              onCreateFundingAccount={onCreateFundingAccount}
              onResetFund={dismissFund}
              onSubmitPhone={onSubmitPhone}
              returnToSavings={isWalletSavingsReturnHref(fundReturnTo)}
              storeCreditTopUp={storeCreditTopUp}
            />
          )}
        </ScrollView>
      ) : null}
    </ModalSheet>
  );
}
