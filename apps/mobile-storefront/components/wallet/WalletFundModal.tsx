import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DraggableModalSheet } from '@/components/ui/DraggableModalSheet';
import { BRAND } from '@/constants/Colors';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { isWalletSavingsReturnHref } from '@/lib/sanitize-wallet-return-to';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';
import type { WalletContentProps } from './WalletContent';
import { WalletFundPanel } from './WalletFundPanel';

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
  | 'primarySetup'
> & { creditWatch: WalletCreditWatch; embedded?: boolean };

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
  onChangeFundAmount,
  onConfirmFund,
  onCreateFundingAccount,
  onResetFund,
  onSubmitPhone,
  showFundPanel,
  primarySetup,
  embedded = false,
}: WalletFundModalProps) {
  const insets = useSafeAreaInsets();
  const primaryCapability = usePiggyvestPrimaryCapability(merchantId);
  function closePanel() {
    primarySetup?.acknowledgeReady();
    onResetFund();
  }
  // Provisioning is tracked by provider, not by account presence: a retained
  // legacy account must not mask pending primary onboarding, and the legacy
  // details stay resolved (nothing is discarded) for transfer display and
  // fallback once setup completes.
  const showPrimarySetup =
    !!merchantId &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    primaryCapability !== false &&
    fundingAccount?.provider !== 'piggyvest';
  return (
    <DraggableModalSheet
      fitContent
      embedded={embedded}
      backgroundColor={colors.card}
      borderColor={BRAND.primary}
      handleColor={BRAND.primary}
      visible={showFundPanel}
      onClose={closePanel}
    >
      {showFundPanel ? (
        <BottomSheetScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
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
              setup={primarySetup}
              onClose={closePanel}
            />
          ) : (
            <WalletFundPanel
              canCreateFundingAccount={canCreateFundingAccount}
              colors={colors}
              createFundingAccountUnavailableMessage={
                createFundingAccountUnavailableMessage
              }
              creditWatch={creditWatch}
              fundAmount={fundAmount}
              fundingAccount={fundingAccount}
              isCreatingFundingAccount={isCreatingFundingAccount}
              isFundPending={isFundPending}
              needsPhone={needsPhone}
              onChangeFundAmount={onChangeFundAmount}
              onConfirmFund={onConfirmFund}
              onCreateFundingAccount={onCreateFundingAccount}
              onResetFund={closePanel}
              onSubmitPhone={onSubmitPhone}
              returnToSavings={isWalletSavingsReturnHref(fundReturnTo)}
              celebrateAccountReady={primarySetup?.justCreated}
            />
          )}
        </BottomSheetScrollView>
      ) : null}
    </DraggableModalSheet>
  );
}
