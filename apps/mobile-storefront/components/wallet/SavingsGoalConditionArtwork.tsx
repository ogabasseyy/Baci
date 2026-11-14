import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatProductConditionDisplay } from '@/types/product';
import { SavingsGoalArtwork } from './SavingsGoalArtwork';

/** Below this size an overlaid badge would cover the phone icon. */
const MIN_OVERLAY_BADGE_SIZE = 72;

/**
 * Shows only the recorded device condition; legacy goals do not receive an
 * invented badge. Large artwork carries it in the corner; small artwork puts
 * it underneath so it never covers the picture.
 */
export function SavingsGoalConditionArtwork({
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
  const condition = formatProductConditionDisplay(goal.product_condition);
  const below = size < MIN_OVERLAY_BADGE_SIZE;
  return (
    <View style={below ? styles.column : { height: size, width: size }}>
      <SavingsGoalArtwork
        colors={colors}
        goal={goal}
        imageRequestSize={imageRequestSize}
        size={size}
      />
      {condition ? (
        <Text
          accessibilityLabel={`Device condition: ${condition}`}
          style={[
            styles.badge,
            below ? styles.badgeBelow : styles.badgeOverlay,
            {
              backgroundColor: colors.primary,
              color: colors.primaryForeground,
            },
          ]}
        >
          {condition}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'center', gap: 4 },
  badgeOverlay: { position: 'absolute', top: 0, left: 0 },
  badgeBelow: { alignSelf: 'center' },
  badge: {
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 9,
    fontWeight: '700',
    maxWidth: '100%',
  },
});
