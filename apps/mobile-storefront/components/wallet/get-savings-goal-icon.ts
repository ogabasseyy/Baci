import type Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';

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

/** Picks a themed icon for the kind of thing being saved for. */
export function getSavingsGoalIcon(title: string): IconName {
  return (
    CATEGORY_ICONS.find(([pattern]) => pattern.test(title))?.[1] ??
    'gift-outline'
  );
}
