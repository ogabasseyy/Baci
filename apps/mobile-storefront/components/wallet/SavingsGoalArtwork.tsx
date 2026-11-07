import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsGoalIcon } from './get-savings-goal-icon';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';

/**
 * The goal's product photo, or a friendly themed tile when there is none.
 * `size` is the tile edge; the photo is requested a little larger for sharpness.
 * A failed URL stays on the fallback until the user retries or the URL changes.
 */
export function SavingsGoalArtwork({
  colors,
  goal,
  imageRequestSize,
  size,
}: {
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal;
  imageRequestSize: number;
  size: number;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const failed = Boolean(
    goal.product_image && failedImage === goal.product_image
  );
  const source = failed
    ? null
    : getSavingsGoalImageSource(goal, imageRequestSize);
  const inner = size - 8;
  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: source ? colors.card : colors.primaryLowOpacity,
          height: size,
          width: size,
        },
      ]}
    >
      {source ? (
        <Image
          accessibilityLabel={goal.title}
          source={source}
          onError={() => setFailedImage(goal.product_image ?? null)}
          style={{ height: inner, width: inner }}
          contentFit="contain"
          autoplay={false}
        />
      ) : (
        <Pressable
          accessible={failed}
          accessibilityRole={failed ? 'button' : undefined}
          accessibilityLabel={
            failed ? `Retry photo for ${goal.title}` : undefined
          }
          accessibilityHint={
            failed ? 'Try loading the product photo again' : undefined
          }
          disabled={!failed}
          onPress={() => setFailedImage(null)}
        >
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${goal.title} savings goal`}
            style={[styles.badge, { backgroundColor: colors.card }]}
          >
            <Ionicons
              name={getSavingsGoalIcon(goal.title)}
              size={Math.round(size * 0.4)}
              color={colors.primary}
            />
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    justifyContent: 'center',
  },
  badge: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    justifyContent: 'center',
    padding: 14,
  },
});
