import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text } from 'react-native';
import { WALLET_COLORS } from './wallet.colors';
import { styles } from './wallet.styles';

type WalletHeroStartSavingsButtonProps = {
  onPress: () => void;
};

/**
 * Start Savings call to action, shown at the foot of the wallet card when the
 * customer has no savings plan yet, so the card carries the next step.
 */
export function WalletHeroStartSavingsButton({
  onPress,
}: WalletHeroStartSavingsButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start Savings"
      accessibilityHint="Choose a goal and start saving towards it"
      onPress={onPress}
      style={styles.heroStartSavingsButton}
    >
      <Ionicons
        accessible={false}
        importantForAccessibility="no"
        name="sparkles-outline"
        size={17}
        color={WALLET_COLORS.white}
      />
      <Text style={styles.heroStartSavingsText}>Start Savings</Text>
    </Pressable>
  );
}
