import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/** App-wide, so a rejected add from a product page is explained too; clears after the next successful edit, on dismissal, or when replaced by a newer failure. */
export function CartWriteNotice() {
  const notice = useNativeSharedCartStore((state) => state.writeNotice);
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  return (
    <View
      pointerEvents="auto"
      style={[
        styles.panel,
        { backgroundColor: colors.background, paddingTop: insets.top + 12 },
      ]}
    >
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={[styles.text, { color: colors.text }]}
      >
        {notice}
      </Text>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    // Android stacks by elevation, not zIndex alone.
    elevation: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  text: { flex: 1 },
});
