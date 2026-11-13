import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { useColorScheme } from '@/components/useColorScheme';
import { useLegacyFundingUnconfirmed } from '@/hooks/use-legacy-funding-unconfirmed';
import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { isPiggyvestCardOnlyMerchant } from '@/lib/is-piggyvest-card-only-merchant';
import { isWalletPurchaseReturnHref } from '@/lib/is-wallet-purchase-return-href';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { wasPiggyvestLastRuledOut } from '@/lib/piggyvest-primary-capability-cache';
import { isWalletSavingsReturnHref } from '@/lib/sanitize-wallet-return-to';
import { WalletFundPromptCard } from './fund/WalletFundPromptCard';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';
import { SavingsNoticeCard } from './savings/SavingsNoticeCard';
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

// Inside a panel: the panel's own side padding applies.
const INLINE_GAP = { marginTop: 4 };

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
  const verdictNow = usePiggyvestCapabilityNow(merchantId);
  const isDark = useColorScheme() === 'dark';
  // An old account number isn't offered until PiggyVest is ruled in or out.
  const legacyUnconfirmed = useLegacyFundingUnconfirmed(
    fundingAccount?.provider
  );
  // Card top-ups credit the legacy wallet, so only primary-funded flows (a
  // savings shortfall or a plain top-up) lose the card option; any other
  // return flow (e.g. IMEI check) still spends the legacy balance.
  const primaryReady = useWalletPrimaryReady();
  // PiggyVest merchant whose primary wallet the server hasn't ruled out.
  // The live verdict follows a rollback written while this sheet is open
  // (Codex); the hook's own answer is the fallback before any verdict.
  const piggyvestMerchant = isPiggyvestCardOnlyMerchant(
    merchantId,
    verdictNow ?? primaryCapability
  );
  // A purchase return (IMEI check, utilities) spends store credit, which
  // only a card top-up adds: the PiggyVest account would fund savings.
  // Also when the PiggyVest read is unknown (timed out) or not set up yet,
  // so the purchase never detours into PiggyVest setup.
  // Same rule as the purchase screens: an
  // unsettled wallet at a merchant not ruled out is a store credit top-up.
  const storeCreditTopUp =
    isWalletPurchaseReturnHref(fundReturnTo) &&
    (primaryReady ||
      piggyvestMerchant ||
      // The live verdict wins over this hook's own (Codex).
      (walletPrimaryUnsettled && (verdictNow ?? primaryCapability) !== false) ||
      // No verdict yet: a restored legacy wallet isn't trusted (Codex).
      (primaryCapability === null && verdictNow === null));
  // Every other PiggyVest top-up (plain, savings plan, start savings) funds
  // the savings wallet by bank transfer, never by card.
  // A PiggyVest account with its balance still pending is primary too
  // (Codex): a card top-up there would add store credit, not savings.
  // Also until PiggyVest is ruled out (Codex): a card top-up started before
  // the verdict could settle on the legacy rail as store credit.
  const hideCardFunding =
    (primaryReady ||
      fundingAccount?.provider === 'piggyvest' ||
      verdictNow !== false) &&
    !storeCreditTopUp;
  // A store credit top-up opened from a purchase pushes the wallet page;
  // dismissing the sheet returns straight to that purchase instead of
  // leaving the customer on the pushed page (walk-through M8).
  // Latched while open (Codex): a verdict change mid-sheet must not strand
  // a customer who arrived from a purchase on the wallet page.
  // Scoped to that purchase and cleared whenever the sheet closes (Codex),
  // including programmatic closes, so a later savings sheet never inherits it.
  const [latchedReturn, setLatchedReturn] = useState<string | null>(null);
  if (showFundPanel && storeCreditTopUp && fundReturnTo && !latchedReturn)
    setLatchedReturn(fundReturnTo);
  if (!showFundPanel && latchedReturn) setLatchedReturn(null);
  const dismissFund = () => {
    onResetFund();
    const returnToPurchase =
      storeCreditTopUp || (!!fundReturnTo && latchedReturn === fundReturnTo);
    setLatchedReturn(null);
    if (!returnToPurchase || !fundReturnTo) return;
    // Back to that purchase, not merely the previous screen (Codex): a warm
    // deep link may sit on unrelated history. dismissTo pops to the purchase
    // when it is in the stack and opens it otherwise (cold deep link).
    router.dismissTo(fundReturnTo);
  };
  // Provisioning is tracked by provider, not by account presence: a retained
  // legacy account must not mask pending primary onboarding, and the legacy
  // details stay resolved (nothing is discarded) for transfer display and
  // fallback once setup completes.
  // Not while a rollback's ruling-out has just expired (Codex): the stale
  // hook's true must not reopen PiggyVest setup; the sheet keeps checking.
  const showPrimarySetup =
    !storeCreditTopUp &&
    !!merchantId &&
    piggyvestMerchant &&
    !(verdictNow === null && wasPiggyvestLastRuledOut(merchantId)) &&
    fundingAccount?.provider !== 'piggyvest';
  // Keep the panel rendered while the card slides down on close, so the
  // exit animation shows the sheet instead of an empty card; it unmounts
  // (clearing any retained BVN state) once the slide has finished.
  const piggyvestSheet =
    !storeCreditTopUp &&
    (showPrimarySetup || fundingAccount?.provider === 'piggyvest');
  // Funding outcomes and questions stay inside the sheet, under its header
  // (never above the drag handle, never an iOS alert).
  const notices = (
    <>
      <SavingsNoticeCard colors={colors} style={INLINE_GAP} />
      <WalletFundPromptCard colors={colors} style={INLINE_GAP} />
    </>
  );
  const [retainContent, setRetainContent] = useState(showFundPanel);
  if (showFundPanel && !retainContent) setRetainContent(true);
  return (
    <ModalSheet
      presentation="fade-backdrop"
      backdropStyle={{
        // PiggyVest: the savings sheet's dark scrim, so the black wallet card
        // stays dark behind it. Other stores keep today's soft wash.
        backgroundColor:
          piggyvestSheet || isDark
            ? 'rgba(0,0,0,0.55)'
            : 'rgba(226,232,240,0.72)',
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
          // PiggyVest sheet: no rubber-band, so its header never scrolls away
          // when the content already fits.
          alwaysBounceVertical={!piggyvestSheet}
          bounces={!piggyvestSheet}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* PiggyVest setup outranks the hold: it never shows the old account. */}
          {legacyUnconfirmed && !storeCreditTopUp && !showPrimarySetup ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.textSecondary, padding: 24 }}
            >
              Checking your account…
            </Text>
          ) : showPrimarySetup ? (
            <PiggyvestWalletSetupPanel
              colors={colors}
              merchantId={merchantId}
              needsPhone={needsPhone}
              onSubmitPhone={onSubmitPhone}
              onRefresh={onRefresh}
              onClose={onResetFund}
              notices={notices}
            />
          ) : (
            <WalletFundPanel
              canCreateFundingAccount={canCreateFundingAccount}
              colors={colors}
              createFundingAccountUnavailableMessage={
                createFundingAccountUnavailableMessage
              }
              creditWatch={
                // PiggyVest transfers never reach the store-credit ledger,
                // also while the PiggyVest balance is still pending (Codex).
                primaryReady || fundingAccount?.provider === 'piggyvest'
                  ? undefined
                  : creditWatch
              }
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
              notices={notices}
              returnToSavings={isWalletSavingsReturnHref(fundReturnTo)}
              storeCreditTopUp={storeCreditTopUp}
            />
          )}
        </ScrollView>
      ) : null}
    </ModalSheet>
  );
}
