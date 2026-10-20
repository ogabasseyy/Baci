import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
export default function SearchLoadingCards({
  colors,
}: {
  colors: (typeof Colors)['light'];
}) {
  return (
    <View
      style={styles.container}
      accessibilityLabel="Searching products"
      accessibilityLiveRegion="polite"
    >
      <Text style={{ color: colors.textSecondary, marginBottom: 16 }}>
        Searching…
      </Text>
      <View style={styles.grid}>
        {['a', 'b', 'c', 'd'].map((key) => (
          <View
            key={key}
            style={[styles.card, { backgroundColor: colors.card }]}
            testID="search-loading-card"
          >
            <View style={[styles.image, { backgroundColor: colors.muted }]} />
            <View style={[styles.line, { backgroundColor: colors.muted }]} />
            <View style={[styles.price, { backgroundColor: colors.muted }]} />
          </View>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '48%',
    borderRadius: 16,
    overflow: 'hidden',
    paddingBottom: 16,
  },
  image: { aspectRatio: 1 },
  line: { height: 14, margin: 12, borderRadius: 4 },
  price: { height: 18, marginHorizontal: 12, width: '55%', borderRadius: 4 },
});
