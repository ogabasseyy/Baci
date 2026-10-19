import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function PlanTransferActions({
  colors,
  controller,
  onConfirmTransfer,
  onContributeFromWallet,
}: TransferModalProps & {
  onConfirmTransfer: () => void;
  onContributeFromWallet: () => void;
}) {
  const usePlanAccount =
    controller.planFundingPhase === 'ready' &&
    controller.planFundingAccounts.length > 0;
  return (
    <View style={styles.transferActionRow}>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          usePlanAccount
            ? 'Confirm plan transfer'
            : 'Record wallet contribution'
        }
        accessibilityState={{ disabled: controller.isSubmitting }}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          controller.isSubmitting ? styles.buttonDisabled : null,
        ]}
        onPress={usePlanAccount ? onConfirmTransfer : onContributeFromWallet}
        disabled={controller.isSubmitting}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          {usePlanAccount ? "I've made the transfer" : "I've funded wallet"}
        </Text>
      </Pressable>
    </View>
  );
}
