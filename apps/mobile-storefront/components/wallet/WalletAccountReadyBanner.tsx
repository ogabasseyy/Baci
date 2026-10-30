import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import { triggerHaptic } from '@/hooks/use-haptics';

export function WalletAccountReadyBanner({
  colors,
}: {
  colors: (typeof Colors)['light'];
}) {
  useEffect(() => {
    triggerHaptic('success');
  }, []);
  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: colors.primaryLowOpacity,
          borderColor: colors.primary,
        },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
        <Ionicons
          name="checkmark"
          size={26}
          color={colors.primaryForeground}
          accessible={false}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>
          Your wallet is ready!
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          One step closer to your next upgrade.
        </Text>
      </View>
      <Ionicons
        name="sparkles"
        size={20}
        color={colors.primary}
        accessible={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 5 },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
});
