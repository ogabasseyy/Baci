import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/** App-wide, so a rejected add from a product page is explained too; clears on the next edit or dismissal. */
export function CartWriteNotice() {
  const notice = useNativeSharedCartStore((state) => state.writeNotice);
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.panel,
        { backgroundColor: colors.background, paddingTop: insets.top + 12 },
      ]}
    >
      <Text style={[styles.text, { color: colors.text }]}>{notice}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss cart message"
        onPress={() => useNativeSharedCartStore.setState({ writeNotice: null })}
        hitSlop={8}
      >
        <Text style={{ color: colors.primary }}>Dismiss</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  text: { flex: 1 },
});
