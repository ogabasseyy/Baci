import Ionicons from '@react-native-vector-icons/ionicons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { palette, RADIUS, SPACING } from '@/constants/Colors';

interface ProfileRewardsCardProps {
  loyaltyPoints: number;
}

/**
 * Reward-points strip on the profile header. Redeem tracks its own pressed
 * state and takes a plain style array: NativeWind's css-interop drops Pressable
 * style callbacks on device, which left it as unstyled dark text on red.
 */
export function ProfileRewardsCard({ loyaltyPoints }: ProfileRewardsCardProps) {
  const [isRedeemPressed, setIsRedeemPressed] = useState(false);

  return (
    <Animated.View
      entering={FadeInDown.delay(350).duration(500)}
      style={styles.pointsCard}
    >
      <View style={styles.pointsLeft}>
        <View style={styles.sparkle}>
          <Ionicons name="sparkles" size={18} color={palette.amber[400]} />
        </View>
        <View>
          <Text style={styles.pointsLabel}>Reward Points</Text>
          <Text style={styles.pointsValue}>
            {loyaltyPoints.toLocaleString()}
          </Text>
        </View>
      </View>
      <Pressable
        style={[styles.redeemBtn, isRedeemPressed && { opacity: 0.8 }]}
        onPressIn={() => setIsRedeemPressed(true)}
        onPressOut={() => setIsRedeemPressed(false)}
        onPress={() => {
          setIsRedeemPressed(false);
          router.push('/wallet' as Href);
        }}
        onBlur={() => setIsRedeemPressed(false)}
        accessibilityRole="button"
        accessibilityLabel="View wallet and redeem points"
      >
        <Text style={styles.redeemText}>Redeem</Text>
        <Ionicons name="arrow-forward" size={14} color={palette.amber[900]} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pointsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS['2xl'],
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pointsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sparkle: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.lg,
    backgroundColor: `${palette.amber[500]}25`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pointsLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pointsValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  redeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.amber[400],
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  redeemText: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.amber[900],
  },
});
