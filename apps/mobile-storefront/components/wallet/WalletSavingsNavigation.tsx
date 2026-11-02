import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';

export function WalletSavingsNavigation({
  colors,
  count,
  showAll = true,
}: {
  colors: (typeof Colors)['light'];
  count: number;
  showAll?: boolean;
}) {
  if (count === 0) return null;
  return (
    <View style={styles.row}>
      {showAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View all plans (${count})`}
          onPress={() => router.push('/wallet/savings')}
          style={styles.action}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            View all plans ({count})
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new plan"
        onPress={() => router.push('/wallet/savings/start')}
        style={[
          styles.action,
          { borderColor: BRAND.primary, borderWidth: 1, borderRadius: 14 },
        ]}
      >
        <Text style={{ color: BRAND.primary, fontWeight: '700' }}>
          + Start a new plan
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 16,
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
});
