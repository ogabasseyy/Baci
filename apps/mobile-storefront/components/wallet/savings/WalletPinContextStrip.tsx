import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { walletPinSheetStyles as styles } from './WalletPinSheet.styles';

type WalletColors = (typeof Colors)['light'];

/** The "Adding ₦X to savings" strip under the title. */
export function WalletPinContextStrip({
  colors,
  text,
}: {
  colors: WalletColors;
  text: string;
}) {
  return (
    <View style={[styles.context, { backgroundColor: colors.muted }]}>
      <Ionicons name="wallet-outline" size={16} color={colors.primary} />
      <Text style={[styles.contextText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}
