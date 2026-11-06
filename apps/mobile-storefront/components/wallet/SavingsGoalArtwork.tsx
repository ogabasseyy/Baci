import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';

type IconName = ComponentProps<typeof Ionicons>['name'];

const CATEGORY_ICONS: readonly (readonly [RegExp, IconName])[] = [
  [/laptop|macbook|notebook|chromebook/i, 'laptop-outline'],
  [/ipad|tablet|tab\b/i, 'tablet-portrait-outline'],
  [/watch/i, 'watch-outline'],
  [/airpod|earbud|headphone|headset|earphone/i, 'headset-outline'],
  [
    /playstation|ps[45]\b|xbox|nintendo|console|controller/i,
    'game-controller-outline',
  ],
  [/\btv\b|television|monitor/i, 'tv-outline'],
  [/camera|gopro/i, 'camera-outline'],
  [
    /iphone|phone|galaxy|pixel|tecno|infinix|itel|xiaomi|redmi|oppo/i,
    'phone-portrait-outline',
  ],
];

/** A themed icon for the kind of thing being saved for. */
export function getSavingsGoalIcon(title: string): IconName {
  return (
    CATEGORY_ICONS.find(([pattern]) => pattern.test(title))?.[1] ??
    'gift-outline'
  );
}

/**
 * The goal's product photo, or a friendly themed tile when there is none.
 * `size` is the tile edge; the photo is requested a little larger for sharpness.
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
  const source = getSavingsGoalImageSource(goal, imageRequestSize);
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
          style={{ height: inner, width: inner }}
          contentFit="contain"
          autoplay={false}
        />
      ) : (
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
