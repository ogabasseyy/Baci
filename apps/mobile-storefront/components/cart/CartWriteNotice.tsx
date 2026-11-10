import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/** Says why a cart edit was undone, in plain language, until dismissed or the next edit. */
export function CartWriteNotice() {
  const notice = useNativeSharedCartStore((state) => state.writeNotice);
  const colors = Colors[useColorScheme() ?? 'light'];
  if (!notice) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.panel, { backgroundColor: colors.background }]}
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
