import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsNavigation } from './WalletSavingsNavigation';
import { WalletSavingsPlanCard } from './WalletSavingsPlanCard';

export function WalletSavingsCarousel({
  goals,
  colors,
  featuredGoalId,
  onOpenFeatured,
}: {
  goals: WalletActiveSavingsGoal[];
  colors: (typeof Colors)['light'];
  featuredGoalId?: string;
  onOpenFeatured: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const cardWidth = Math.max(1, width - (goals.length > 1 ? 28 : 0));
  const currentPage = Math.min(page, Math.max(0, goals.length - 1));
  return (
    <View
      testID="savings-carousel"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <WalletSavingsNavigation colors={colors} count={goals.length} />
      {width > 0 && goals.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth}
          decelerationRate="fast"
          snapToAlignment="start"
          onMomentumScrollEnd={(event) =>
            setPage(
              Math.max(
                0,
                Math.min(
                  goals.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / cardWidth)
                )
              )
            )
          }
        >
          {goals.map((goal) => (
            <View key={goal.id} style={{ width: cardWidth }}>
              <WalletSavingsPlanCard
                goal={goal}
                colors={colors}
                onOpen={() =>
                  goal.id === featuredGoalId
                    ? onOpenFeatured()
                    : router.push({
                        pathname: '/wallet',
                        params: { action: 'savings', savingsGoalId: goal.id },
                      })
                }
              />
            </View>
          ))}
        </ScrollView>
      ) : null}
      {goals.length > 1 ? (
        <View
          style={styles.pagination}
          accessibilityLabel={`Savings plan ${currentPage + 1} of ${goals.length}`}
        >
          <Text style={[styles.caption, { color: colors.textSecondary }]}>
            Swipe to switch plans
          </Text>
          <View style={styles.dots}>
            {goals.map((goal, index) => (
              <View
                key={goal.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === currentPage ? BRAND.primary : colors.border,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pagination: { alignItems: 'center', gap: 8, paddingTop: 12 },
  caption: { fontSize: 11 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
