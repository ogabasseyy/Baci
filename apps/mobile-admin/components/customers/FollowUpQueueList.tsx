import type { ListRenderItemInfo } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import { type ReactElement, type RefObject, useEffect, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FollowUpEmptyState } from '@/components/customers/FollowUpEmptyState';
import { FollowUpErrorBanner } from '@/components/customers/FollowUpErrorBanner';
import { FollowUpFilteredEmptyState } from '@/components/customers/FollowUpFilteredEmptyState';
import { StaffFollowUpEditor } from '@/components/customers/StaffFollowUpEditor';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { useFollowUpQueue } from '@/hooks/useFollowUpQueue';
import { useStaffOrderFollowUps } from '@/hooks/useStaffOrderFollowUps';
import { useTheme } from '@/hooks/useTheme';
import {
  type GroupedFailedOrderListItem,
  groupFailedOrdersByDate,
} from '@/lib/customers-failed-orders';
import { STAFF_FOLLOW_UP_LABELS } from '@/schemas/staff-follow-up';

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
    isFollowUpLimited,
    isRefreshing,
    merchant,
    refresh,
    viewState,
  } = useFollowUpQueue();
  const { user } = useAuth();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [claimedOrderId, setClaimedOrderId] = useState<string | null>(null);
  const orderIds = failedOrders?.map((order) => order.id).sort() ?? [];
  const staffFollowUps = useStaffOrderFollowUps(
    merchant?.id,
    user?.id,
    orderIds
  );
  const sourceOrderIds = new Set(orderIds);
  const orders = [
    ...(failedOrders ?? []),
    ...(staffFollowUps.openOrders ?? []).filter(
      (order) => !sourceOrderIds.has(order.id)
    ),
  ];
  const followUpCount = orders.length;
  const isLimited = isFollowUpLimited || staffFollowUps.isLimited;
  const emptyViewState =
    viewState.status === 'empty' && staffFollowUps.isLoading
      ? ({ status: 'loading' } as const)
      : viewState;
  const selectedOrder = orders.find((order) => order.id === selectedOrderId);
  const selectedFollowUp = selectedOrder
    ? staffFollowUps.data?.[selectedOrder.id]
    : undefined;
  const refreshQueue = async () => {
    await Promise.allSettled([
      refresh(),
      ...(merchant?.id && user?.id ? [staffFollowUps.refetch()] : []),
    ]);
  };

  useEffect(() => {
    onFollowUpCountChange(followUpCount);
  }, [followUpCount, onFollowUpCountChange]);

  const filteredFailedOrders = (() => {
    if (!searchQuery.trim()) return orders;

    const query = searchQuery.trim().toLowerCase();
    const phoneQuery = /^[\d+().\s-]+$/.test(query)
      ? query.replace(/\D/g, '')
      : '';
    return orders.filter(
      (order) =>
        (order.customer_name?.toLowerCase().includes(query) ?? false) ||
        (order.customer_email?.toLowerCase().includes(query) ?? false) ||
        (order.order_number?.toLowerCase().includes(query) ?? false) ||
        (phoneQuery.length >= 4 &&
          (order.customer_phone?.replace(/\D/g, '').includes(phoneQuery) ??
            false))
    );
  })();
  const { data: groupedFailedOrders, stickyHeaderIndices } =
    groupFailedOrdersByDate(filteredFailedOrders);
  const hasFilteredFollowUpSearchEmpty =
    followUpCount > 0 &&
    searchQuery.trim().length > 0 &&
    groupedFailedOrders.length === 0;

  return (
    <>
      <FlashList<GroupedFailedOrderListItem>
        ref={scrollRef as never}
        data={groupedFailedOrders}
        extraData={staffFollowUps.data}
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

          const order = item.data;
          const followUp = staffFollowUps.data?.[order.id];
          const card = renderOrder(order, currencySymbol);
          if (!card || !staffFollowUps.isSuccess) return card;
          return (
            <View style={styles.queueItem}>
              {card}
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Open team follow-up details"
                onPress={() => setSelectedOrderId(order.id)}
                style={[styles.staffAction, { backgroundColor: colors.card }]}
              >
                <Text style={{ color: colors.text }}>
                  {STAFF_FOLLOW_UP_LABELS[followUp?.stage ?? 'needs_follow_up']}{' '}
                  ·{' '}
                  {followUp?.assignee_id
                    ? followUp.assignee_name
                    : 'Unassigned'}
                </Text>
                {followUp?.outcome ? (
                  <Text
                    style={{ color: colors.textSecondary }}
                    numberOfLines={2}
                  >
                    {followUp.outcome}
                  </Text>
                ) : null}
                {followUp?.follow_up_on ? (
                  <Text style={{ color: colors.textSecondary }}>
                    Follow up on {followUp.follow_up_on}
                  </Text>
                ) : null}
                <Text style={{ color: colors.gold }}>
                  {!followUp?.assignee_id
                    ? 'Claim follow-up'
                    : followUp.assignee_id === user?.id
                      ? 'Update follow-up'
                      : 'View follow-up'}
                </Text>
              </Pressable>
            </View>
          );
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
            refreshing={isRefreshing || staffFollowUps.isRefetching}
            onRefresh={refreshQueue}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
        ListHeaderComponent={
          (isFailedOrdersError || isLimited || staffFollowUps.isError) &&
          (followUpCount > 0 || staffFollowUps.isError) ? (
            <FollowUpErrorBanner
              hasError={Boolean(isFailedOrdersError || staffFollowUps.isError)}
              isLimited={isLimited}
              isRetrying={isRefreshing || staffFollowUps.isRefetching}
              onRetry={refreshQueue}
            />
          ) : null
        }
        ListEmptyComponent={
          hasFilteredFollowUpSearchEmpty ? (
            <FollowUpFilteredEmptyState />
          ) : emptyViewState.status === 'ready' ||
            staffFollowUps.isError ? null : (
            <FollowUpEmptyState
              viewState={emptyViewState}
              isRetrying={isRefreshing || staffFollowUps.isRefetching}
              onRetry={refreshQueue}
            />
          )
        }
      />
      {selectedOrder && (
        <StaffFollowUpEditor
          key={`${selectedOrder.id}:${selectedFollowUp?.revision ?? 0}`}
          orderId={selectedOrder.id}
          customerName={
            selectedOrder.customer_name ||
            selectedOrder.order_number ||
            'Customer'
          }
          viewerId={user?.id}
          followUp={selectedFollowUp}
          justClaimed={claimedOrderId === selectedOrder.id}
          busy={staffFollowUps.isSaving}
          onClose={() => {
            setSelectedOrderId(null);
            setClaimedOrderId(null);
          }}
          onClaim={async () => {
            const claimed = await staffFollowUps.save({
              type: 'claim',
              orderId: selectedOrder.id,
            });
            // The editor remounts on the new revision, so the parent carries
            // the "you just claimed this" notice across the remount.
            setClaimedOrderId(selectedOrder.id);
            return claimed;
          }}
          onSave={(fields) => staffFollowUps.save({ type: 'update', fields })}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  queueItem: { gap: SPACING.xs },
  staffAction: {
    minHeight: 44,
    padding: SPACING.md,
    borderRadius: 12,
    gap: SPACING.xs,
  },
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
