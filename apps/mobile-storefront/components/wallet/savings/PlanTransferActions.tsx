import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function PlanTransferActions({
  colors,
  controller,
  onConfirmTransfer,
}: Pick<TransferModalProps, 'colors'> & {
  controller: Pick<
    TransferModalProps['controller'],
    | 'planFundingPhase'
    | 'planFundingAccounts'
    | 'isSubmitting'
    | 'openWalletFundingScreen'
  >;
  onConfirmTransfer: () => void;
}) {
  const usePlanAccount =
    controller.planFundingPhase === 'ready' &&
    Boolean(controller.planFundingAccounts[0]?.accountNumber.trim());
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
      {usePlanAccount ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Confirm plan transfer"
          accessibilityState={{ disabled: controller.isSubmitting }}
          style={[
            styles.secondaryButton,
            { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
            controller.isSubmitting ? styles.buttonDisabled : null,
          ]}
          onPress={onConfirmTransfer}
          disabled={controller.isSubmitting}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
            Check transfer status
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
