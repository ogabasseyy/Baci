import { Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { FundingAccountDetails } from './FundingAccountDetails';
import { startSavingsStyles as styles } from './start-savings.styles';
import { SummaryRow } from './start-savings-modal-parts';
import type { TransferModalProps } from './start-savings-transfer-modal-props';
import { TransferActions } from './TransferActions';

export function WalletTransferMode({ colors, controller }: TransferModalProps) {
  const transferAmount = Math.max(
    controller.requiredTopUpAmount,
    controller.contributionValue
  );

  return (
    <ModalSheet
      visible={controller.showTransferModal}
      animationType="slide"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Fund wallet to continue
      </Text>
      <View
        style={[
          styles.transferCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <SummaryRow
          label="Transfer amount"
          value={formatNgnCurrency(transferAmount)}
          colors={colors}
        />
        {controller.fundingAccount ? (
          <FundingAccountDetails colors={colors} controller={controller} />
        ) : (
          <Text
            style={[
              styles.emptyFundingAccountText,
              { color: colors.textSecondary },
            ]}
          >
            Create your account number from the wallet funding screen before
            continuing.
          </Text>
        )}
      </View>
      <TransferActions colors={colors} controller={controller} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open wallet funding screen"
        style={styles.modalCloseButton}
        onPress={controller.openWalletFundingScreen}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Open wallet funding screen
        </Text>
      </Pressable>
    </ModalSheet>
  );
}
