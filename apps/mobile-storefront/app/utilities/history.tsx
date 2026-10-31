import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  View,
} from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import { utilityHistoryHelpers } from '@/components/utilities/history.helpers';
import { styles } from '@/components/utilities/history.styles';
import UtilityHistoryEmptyState from '@/components/utilities/UtilityHistoryEmptyState';
import UtilityHistoryFilters from '@/components/utilities/UtilityHistoryFilters';
import UtilityTransactionCard from '@/components/utilities/UtilityTransactionCard';
import { useUtilityHistoryActions } from '@/components/utilities/use-utility-history-actions';
import Colors, { BRAND, SPACING } from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import {
  type UtilityHistoryFilter,
  useVTUHistory,
  type VTUHistoryTransaction,
} from '@/hooks/use-vtu-history';

const EMPTY_TRANSACTIONS: VTUHistoryTransaction[] = [];

export default function UtilityHistoryScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { getScrollContentStyle } = useStorefrontInsets();
  const { isLoading: authLoading, redirectTo } = useRequireAuth();
  const [selectedFilter, setSelectedFilter] = useState<UtilityHistoryFilter>(
    utilityHistoryHelpers.resolveFilter(type)
  );
  // Sync the filter inline during render when the route param changes
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setSelectedFilter(utilityHistoryHelpers.resolveFilter(type));
  }
  const {
    data: transactions,
    error,
    isLoading,
    isRefetching,
    refetch,
  } = useVTUHistory(selectedFilter, 30);
  const {
    handleCopyVoucher,
    handleRepeatTransaction,
    handleShareReceipt,
    handleSyncPayment,
    sharingTransactionId,
    syncingTransactionId,
  } = useUtilityHistoryActions({ refetch });

  if (authLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Utility History' }} />
        <StorefrontScreenShell
          style={[styles.container, { backgroundColor: colors.background }]}
          edges={['bottom']}
        >
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={BRAND.primary} />
          </View>
        </StorefrontScreenShell>
      </>
    );
  }

  if (redirectTo) {
    return <Redirect href={redirectTo} />;
  }

  const scrollContentStyle = getScrollContentStyle({
    includeBottomInset: false,
    paddingBottom: SPACING.md,
    paddingTop: SPACING.md,
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Utility History' }} />
      <StorefrontScreenShell
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <FlatList<VTUHistoryTransaction>
          data={transactions ?? EMPTY_TRANSACTIONS}
          renderItem={({ item }) => (
            <UtilityTransactionCard
              colors={colors}
              handleCopyVoucher={handleCopyVoucher}
              handleRepeatTransaction={handleRepeatTransaction}
              handleShareReceipt={handleShareReceipt}
              handleSyncPayment={handleSyncPayment}
              sharingTransactionId={sharingTransactionId}
              syncingTransactionId={syncingTransactionId}
              transaction={item}
            />
          )}
          keyExtractor={(transaction) => transaction.id}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => {
                void refetch();
              }}
              tintColor={BRAND.primary}
            />
          }
          contentContainerStyle={[styles.content, scrollContentStyle]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <UtilityHistoryFilters
              colors={colors}
              selectedFilter={selectedFilter}
              setSelectedFilter={setSelectedFilter}
            />
          }
          ListEmptyComponent={
            <UtilityHistoryEmptyState
              colors={colors}
              error={error}
              isLoading={isLoading}
              refetch={refetch}
            />
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
        />
      </StorefrontScreenShell>
    </>
  );
}
