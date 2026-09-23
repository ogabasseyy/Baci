import type { ListRenderItemInfo } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import { type ReactElement, type RefObject, useEffect } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FollowUpEmptyState } from '@/components/customers/FollowUpEmptyState';
import { FollowUpErrorBanner } from '@/components/customers/FollowUpErrorBanner';
import { FollowUpFilteredEmptyState } from '@/components/customers/FollowUpFilteredEmptyState';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { useFollowUpQueue } from '@/hooks/useFollowUpQueue';
import { useTheme } from '@/hooks/useTheme';
import {
  type GroupedFailedOrderListItem,
  groupFailedOrdersByDate,
} from '@/lib/customers-failed-orders';

interface FollowUpQueueListProps {
  currencySymbol: string;
  onFollowUpCountChange: (count: number) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  renderOrder: (
    item: FailedOrder,
    currencySymbol: string
  ) => ReactElement | null;
  searchQuery: string;
  scrollRef?: RefObject<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  } | null>;
}

/**
 * Owns the Follow Up queue lifecycle so the Customers screen remains focused
 * on tab selection and regular customer browsing.
 */
export function FollowUpQueueList({
  currencySymbol,
  onFollowUpCountChange,
  onScroll,
  renderOrder,
  searchQuery,
  scrollRef,
}: FollowUpQueueListProps) {
  const { colors } = useTheme();
  const {
    failedOrders,
    isFailedOrdersError,
    isRefreshing,
    refresh,
    viewState,
  } = useFollowUpQueue();
  const followUpCount = failedOrders?.length ?? 0;

  useEffect(() => {
    onFollowUpCountChange(followUpCount);
  }, [followUpCount, onFollowUpCountChange]);

  const filteredFailedOrders = (() => {
    if (!failedOrders || !searchQuery.trim()) return failedOrders ?? [];

    const query = searchQuery.toLowerCase();
    return failedOrders.filter(
      (order) =>
        (order.customer_name?.toLowerCase().includes(query) ?? false) ||
        order.customer_email.toLowerCase().includes(query)
    );
  })();
  const { data: groupedFailedOrders, stickyHeaderIndices } =
    groupFailedOrdersByDate(filteredFailedOrders);
  const hasFilteredFollowUpSearchEmpty =
    viewState.status === 'ready' &&
    searchQuery.trim().length > 0 &&
    groupedFailedOrders.length === 0;

  return (
    <FlashList<GroupedFailedOrderListItem>
      ref={scrollRef as never}
      data={groupedFailedOrders}
      renderItem={({
        item,
      }: ListRenderItemInfo<GroupedFailedOrderListItem>) => {
        if (item.type === 'header') {
          return (
            <View
              style={[
                styles.sectionHeader,
                { backgroundColor: colors.background },
              ]}
            >
              <Text
                style={[
                  styles.sectionHeaderLabel,
                  { color: colors.textSecondary },
                ]}
              >
                {item.title}
              </Text>
            </View>
          );
        }

        return renderOrder(item.data, currencySymbol);
      }}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.type}
      stickyHeaderIndices={stickyHeaderIndices}
      stickyHeaderConfig={{ zIndex: 10, hideRelatedCell: true }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={refresh}
          tintColor={colors.gold}
          colors={[colors.gold]}
        />
      }
      ListHeaderComponent={
        isFailedOrdersError && groupedFailedOrders.length > 0 ? (
          <FollowUpErrorBanner isRetrying={isRefreshing} onRetry={refresh} />
        ) : null
      }
      ListEmptyComponent={
        hasFilteredFollowUpSearchEmpty ? (
          <FollowUpFilteredEmptyState />
        ) : viewState.status === 'ready' ? null : (
          <FollowUpEmptyState
            viewState={viewState}
            isRetrying={isRefreshing}
            onRetry={refresh}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: SPACING.lg,
    paddingTop: 0,
    gap: SPACING.md,
  },
  sectionHeader: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    justifyContent: 'center',
  },
  sectionHeaderLabel: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
