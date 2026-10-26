import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsPlanListCard } from './SavingsPlanListCard';

export function SavingsPlansScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const auth = useRequireAuth();
  const query = useWallet({ cachePolicy: 'display' });
  const [filter, setFilter] = useState<'All' | 'Active' | 'Completed'>('All');
  const goals = query.data?.wallet.savings_goals ?? [];
  const visibleGoals = goals.filter(
    (goal) => filter === 'All' || goal.status === filter.toLowerCase()
  );
  const totalSaved = goals.reduce(
    (total, goal) => total + goal.current_amount,
    0
  );
  const activeCount = goals.filter((goal) => goal.status === 'active').length;
  if (auth.isLoading)
    return <ActivityIndicator accessibilityLabel="Checking sign in" />;
  if (auth.redirectTo) return <Redirect href={auth.redirectTo} />;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => {
            void query.refetch();
          }}
          tintColor={BRAND.primary}
        />
      }
    >
      <View
        style={[
          styles.summary,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.eyebrow, { color: BRAND.primary }]}>
          BUILD YOUR NEXT UPGRADE
        </Text>
        <Text style={[styles.heading, { color: colors.text }]}>
          Your savings plans
        </Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Total saved across your plans
        </Text>
        {query.isLoading && !query.data ? (
          <ActivityIndicator accessibilityLabel="Loading savings plans" />
        ) : (
          <Text style={[styles.total, { color: colors.text }]}>
            {formatNgnCurrency(totalSaved)}
          </Text>
        )}
        <Text style={[styles.support, { color: colors.textSecondary }]}>
          {activeCount} active {activeCount === 1 ? 'plan' : 'plans'} · Every
          goal has its own balance
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new plan"
          onPress={() => router.push('/wallet/savings/start')}
          style={({ pressed }) => [
            styles.newPlan,
            { backgroundColor: BRAND.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.newPlanText, { color: BRAND.onPrimary }]}>
            ＋ New plan
          </Text>
        </Pressable>
      </View>
      {query.isError ? (
        <View
          style={[
            styles.error,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={{ color: colors.textSecondary }}>
            Couldn’t refresh your plans.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading plans"
            onPress={() => {
              void query.refetch();
            }}
            style={styles.retry}
          >
            <Text style={{ color: BRAND.primary, fontWeight: '700' }}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.filters}>
        {(['All', 'Active', 'Completed'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={`${option} plans`}
            accessibilityState={{ selected: filter === option }}
            onPress={() => setFilter(option)}
            style={[
              styles.filter,
              {
                backgroundColor:
                  filter === option ? BRAND.primary : colors.card,
                borderColor: filter === option ? BRAND.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterText,
                {
                  color:
                    filter === option ? BRAND.onPrimary : colors.textSecondary,
                },
              ]}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
        CHOOSE A PLAN · {visibleGoals.length}
      </Text>
      {visibleGoals.map((goal) => (
        <SavingsPlanListCard
          key={goal.id}
          goal={goal}
          colors={colors}
          onPress={() =>
            router.push({
              pathname: '/wallet',
              params: { action: 'savings', savingsGoalId: goal.id },
            })
          }
        />
      ))}
      {!query.isLoading && !query.isError && visibleGoals.length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {filter === 'All'
              ? 'Your next upgrade starts here'
              : `No ${filter.toLowerCase()} plans yet`}
          </Text>
          <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>
            {filter === 'All'
              ? 'Pick a device, set your goal, and save at your pace.'
              : 'Choose All to see your other plans, or start something new.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  summary: { padding: 24, borderRadius: 28, borderWidth: 1, gap: 10 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  heading: { fontSize: 26, fontWeight: '800', lineHeight: 32 },
  label: { fontSize: 13, marginTop: 12 },
  total: { fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'] },
  support: { fontSize: 12, lineHeight: 19 },
  newPlan: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  newPlanText: { fontSize: 16, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 8 },
  filter: {
    minHeight: 44,
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  filterText: { fontSize: 13, fontWeight: '700' },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginTop: 4,
  },
  error: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  retry: { minHeight: 44, justifyContent: 'center' },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 24,
    padding: 24,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyCopy: { fontSize: 14, lineHeight: 22 },
});
