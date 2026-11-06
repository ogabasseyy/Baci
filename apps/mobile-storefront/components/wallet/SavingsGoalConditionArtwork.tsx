import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatProductConditionDisplay } from '@/types/product';
import { SavingsGoalArtwork } from './SavingsGoalArtwork';

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
  return (
    <View style={{ height: size, width: size }}>
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
  badge: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 9,
    fontWeight: '700',
    maxWidth: '100%',
  },
});
