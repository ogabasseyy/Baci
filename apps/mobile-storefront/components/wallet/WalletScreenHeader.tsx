import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './wallet.styles';

type WalletScreenHeaderProps = {
  colors: (typeof Colors)['light'];
  /** Stacked wallet page only: a back button before the title. */
  onBack?: () => void;
  title: string;
};

/**
 * One wallet header for the tab and the stacked page: left-aligned icon and
 * title, plus a back button on the stacked page.
 */
export function WalletScreenHeader({
  colors,
  onBack,
  title,
}: WalletScreenHeaderProps) {
  return (
    <View style={styles.tabHeader}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          onPress={onBack}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      ) : null}
      <Ionicons
        name="wallet-outline"
        size={24}
        color={colors.text}
        accessible={false}
        importantForAccessibility="no"
      />
      <Text
        accessibilityRole="header"
        style={[styles.tabHeaderTitle, { color: colors.text }]}
      >
        {title}
      </Text>
    </View>
  );
}
