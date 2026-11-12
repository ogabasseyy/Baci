import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { walletPinSheetStyles as styles } from './WalletPinSheet.styles';

type WalletColors = (typeof Colors)['light'];

/**
 * The PIN sheet's header: lock icon in a light-red circle, red title, and a
 * close (or back, inside the savings sheet) button when there is one.
 */
export function WalletPinSheetHeader({
  colors,
  title,
  closeLabel,
  embedded = false,
  onClose,
}: {
  colors: WalletColors;
  title: string;
  closeLabel?: string;
  embedded?: boolean;
  onClose?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View
        style={[styles.icon, { backgroundColor: colors.primaryLowOpacity }]}
      >
        <Ionicons name="lock-closed-outline" size={16} color={colors.primary} />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.primary }]}
      >
        {title}
      </Text>
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel ?? (embedded ? 'Back' : 'Close')}
          hitSlop={8}
          onPress={onClose}
          style={styles.close}
        >
          <Ionicons
            name={embedded ? 'arrow-back' : 'close'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
