import { Text, View } from 'react-native';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function FundingAccountDetails({
  colors,
  controller,
}: TransferModalProps) {
  if (!controller.fundingAccount) {
    return null;
  }

  return (
    <>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Account number
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {controller.fundingAccount.account_number}
        </Text>
      </View>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Bank
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {controller.fundingAccount.bank_name}
        </Text>
      </View>
    </>
  );
}
