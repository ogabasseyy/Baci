import { ScrollView } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
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
  | 'onChangeFundAmount'
  | 'onConfirmFund'
  | 'onCreateFundingAccount'
  | 'onResetFund'
  | 'onSubmitPhone'
  | 'showFundPanel'
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
  onChangeFundAmount,
  onConfirmFund,
  onCreateFundingAccount,
  onResetFund,
  onSubmitPhone,
  showFundPanel,
}: WalletFundModalProps) {
  return (
    <ModalSheet
      backdropStyle={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
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
      onRequestClose={onResetFund}
      onBackdropPress={onResetFund}
    >
      {showFundPanel ? (
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
            onResetFund={onResetFund}
            onSubmitPhone={onSubmitPhone}
            returnToSavings={fundReturnTo === '/wallet?action=savings'}
          />
        </ScrollView>
      ) : null}
    </ModalSheet>
  );
}
