import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { RADIUS, TYPOGRAPHY } from '@/constants/Colors';
import { WALLET_COLORS } from './wallet.colors';

type WalletHeroAddMoneyButtonProps = {
  onPress: () => void;
};

/**
 * Add money entry on the PiggyVest wallet card: opens the bank-transfer
 * instructions for the customer's account number.
 */
export function WalletHeroAddMoneyButton({
  onPress,
}: WalletHeroAddMoneyButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add money"
      accessibilityHint="Shows how to transfer money into your savings wallet"
      onPress={onPress}
      style={styles.button}
    >
      <Ionicons
        accessible={false}
        importantForAccessibility="no"
        name="add-circle-outline"
        size={17}
        color={WALLET_COLORS.white}
      />
      <Text style={styles.label}>Add money</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#F8B84C',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  label: {
    color: WALLET_COLORS.white,
    fontSize: 14,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
});
