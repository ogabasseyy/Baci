import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { BRAND } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsSuccessModal({ colors, controller }: Props) {
  return (
    <ModalSheet
      visible={controller.showSuccessModal}
      animationType="fade"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <View style={styles.successIconWrap}>
        <Ionicons name="checkmark" size={28} color={BRAND.primary} />
      </View>
      <Text
        style={[styles.modalTitle, { color: colors.text, textAlign: 'center' }]}
      >
        Savings plan created successfully
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to wallet"
        style={styles.primaryButton}
        onPress={controller.goToWallet}
      >
        <Text style={styles.primaryButtonText}>Go to Wallet</Text>
      </Pressable>
    </ModalSheet>
  );
}
