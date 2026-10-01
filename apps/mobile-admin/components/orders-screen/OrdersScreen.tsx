import type { PaymentStatus, ShippingStatus } from '@baci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAdminTabScrollToTop } from '@/hooks/useAdminTabScrollToTop';
import { useAiInsights } from '@/hooks/useAiInsights';
import { useDebounce } from '@/hooks/useDebounce';
import { useMerchant } from '@/hooks/useMerchant';
import { useOrderCounts } from '@/hooks/useOrderCounts';
import { type Order, useOrders, useUpdateOrderStatus } from '@/hooks/useOrders';
import { useTheme } from '@/hooks/useTheme';
import { getOrdersViewState } from '@/lib/orders-view-state';
import { buildOrdersListData } from './build-orders-list-data';
import { CreateOrderFab } from './CreateOrderFab';
import { createPaymentStatusConfigGetter } from './create-payment-status-config-getter';
import { createShippingStatusConfigGetter } from './create-shipping-status-config-getter';
import { createSourceConfigGetter } from './create-source-config-getter';
import { dedupeOrdersById } from './dedupe-orders-by-id';
import { formatDateChipLabel } from './format-date-chip-label';
import { formatDateRangeLabel } from './format-date-range-label';
import { getStatusActions } from './get-status-actions';
import { OrderItem } from './OrderItem';
import { OrdersHeader } from './OrdersHeader';
import { OrdersInsightCard } from './OrdersInsightCard';
import { OrdersModals } from './OrdersModals';
import { OrdersScrollSurface } from './OrdersScrollSurface';
import { OrdersSectionHeader } from './OrdersSectionHeader';
import { OrdersStatusDropdown } from './OrdersStatusDropdown';
import {
  requiresPaymentPrompt,
  showPaymentRequiredPrompt,
} from './payment-required-alert';
import type {
  OrdersFilterKey,
  OrdersListRow,
  StatusPressLayout,
} from './types';

const MODAL_TRANSITION_DELAY_MS = 300;

export default function OrdersScreen() {
  const scrollRef = useAdminTabScrollToTop<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  }>('orders');
  const { colors, shadows, isDark } = useTheme();
  const { merchant, isLoading: isMerchantLoading, error } = useMerchant();
  const queryClient = useQueryClient();
  const [orderFilter, setOrderFilter] = useState<OrdersFilterKey>('all');
  const [showInsight, setShowInsight] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [dateRange, setDateRange] = useState<
    string | { start: Date; end: Date } | null
  >(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });
  const [completedTodos, setCompletedTodos] = useState<Record<string, boolean>>(
    {}
  );
  const {
    data: aiInsightsData,
    isLoading: isAiInsightsLoading,
    refetch,
  } = useAiInsights();
  const updateStatus = useUpdateOrderStatus();
  const statusFilter: ShippingStatus | undefined =
    orderFilter === 'all' || orderFilter === 'paid' ? undefined : orderFilter;
  const paymentStatusFilter: PaymentStatus | 'all' =
    orderFilter === 'paid' ? 'paid' : 'all';

  const ordersQuery = useOrders(
    statusFilter || 'all',
    debouncedSearch,
    dateRange,
    paymentStatusFilter
  );
  const allOrders = dedupeOrdersById(
    ordersQuery.data?.pages.flatMap((page) => page.orders) ?? []
  );
  const listViewState = getOrdersViewState({
    hasMerchant: Boolean(merchant?.id),
    isMerchantLoading,
    merchantError: error instanceof Error ? error : null,
    isOrdersLoading: ordersQuery.isLoading,
    ordersError: ordersQuery.error instanceof Error ? ordersQuery.error : null,
    ordersLength: allOrders.length,
  });
  const { data: counts } = useOrderCounts();
  const pendingCount = counts?.pending ?? 0;
  const flatListData = buildOrdersListData(allOrders);

  const shippingConfig = createShippingStatusConfigGetter(colors);
  const paymentConfig = createPaymentStatusConfigGetter(colors);
  const sourceConfig = createSourceConfigGetter(colors);
  // Fallback only: each row prefers its own stamped `order.currency` (set at
  // checkout time) since historical orders can predate a merchant
  // payout-currency change.
  const merchantCurrency = merchant?.payout_currency || 'NGN';
  const dateRangeLabel = formatDateRangeLabel(dateRange);
  const dateChipLabel = formatDateChipLabel(dateRange);

  const handleRetry = () => {
    void queryClient.invalidateQueries({ queryKey: ['merchant'] });
    void refetch();

    if (!merchant?.id) return;

    void queryClient.invalidateQueries({ queryKey: ['orders', merchant.id] });
    void queryClient.invalidateQueries({
      queryKey: ['order-counts', merchant.id],
    });
  };

  const openStatusDropdown = (order: Order, layout: StatusPressLayout) => {
    setDropdownPosition({
      x: layout.pageX - 100,
      y: layout.pageY + layout.height + 4,
    });
    setSelectedOrder(order);
    setShowStatusDropdown(true);
  };

  const handleStatusUpdate = async (newStatus: ShippingStatus) => {
    if (!selectedOrder) return;
    if (requiresPaymentPrompt(newStatus, selectedOrder)) {
      setShowStatusDropdown(false);
      showPaymentRequiredPrompt({
        order: selectedOrder,
        onClearSelection: () => setSelectedOrder(null),
      });
      return;
    }

    try {
      await updateStatus.mutateAsync({
        orderId: selectedOrder.id,
        status: newStatus,
      });
      closeStatusDropdown();
    } catch (statusError) {
      console.error('Failed to update status:', statusError);
      Alert.alert(
        'Could not update order status',
        'Check your connection and try again. If this continues, confirm your account has permission to update orders.'
      );
    }
  };

  const renderOrderRow = ({ item }: { item: OrdersListRow }) => {
    if (item.type === 'header') {
      return <OrdersSectionHeader title={item.title} colors={colors} />;
    }

    return (
      <OrderItem
        item={item.order}
        currency={item.order.currency || merchantCurrency}
        onPress={(id) => router.push(`/order/${id}`)}
        onStatusPress={openStatusDropdown}
        getShippingStatusConfig={shippingConfig}
        getPaymentStatusConfig={paymentConfig}
        getSourceConfig={sourceConfig}
      />
    );
  };

  const closeStatusDropdown = () => {
    setShowStatusDropdown(false);
    setSelectedOrder(null);
  };

  const toggleTodo = (todoText: string, isCompleted: boolean) => {
    setCompletedTodos((prev) => ({ ...prev, [todoText]: !isCompleted }));
  };

  const viewPendingOrders = () => {
    setOrderFilter('pending');
    setShowInsight(false);
  };

  const handleLoadMore = () => {
    if (ordersQuery.hasNextPage && !ordersQuery.isFetchingNextPage) {
      ordersQuery.fetchNextPage();
    }
  };

  const handleDateFilterSelect = (
    filter: string | { start: Date | null; end: Date | null } | null
  ) => {
    if (filter === null || typeof filter === 'string') {
      setDateRange(filter);
    } else if (filter.start && filter.end) {
      setDateRange({ start: filter.start, end: filter.end });
    } else {
      setDateRange(null);
    }
  };

  const openReportDatePicker = () => {
    setShowReportModal(false);
    setTimeout(() => setShowDatePicker(true), MODAL_TRANSITION_DELAY_MS);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <OrdersHeader
        colors={colors}
        onOpenReport={() => setShowReportModal(true)}
        onOpenDatePicker={() => setShowDatePicker(true)}
      />
      <OrdersInsightCard
        visible={showInsight}
        colors={colors}
        shadows={shadows}
        isLoading={isAiInsightsLoading}
        insights={aiInsightsData?.insights}
        pendingCount={pendingCount}
        completedTodos={completedTodos}
        onDismiss={() => setShowInsight(false)}
        onTodoToggle={toggleTodo}
        onViewPending={viewPendingOrders}
      />
      <OrdersScrollSurface
        colors={colors}
        searchQuery={searchQuery}
        selectedFilter={orderFilter}
        counts={counts}
        dateChipLabel={dateChipLabel}
        data={flatListData}
        isRefreshing={isMerchantLoading || ordersQuery.isFetching}
        isFetchingNextPage={ordersQuery.isFetchingNextPage}
        listViewState={listViewState}
        renderItem={renderOrderRow}
        onSearchChange={setSearchQuery}
        onFilterSelect={setOrderFilter}
        onClearDate={() => setDateRange(null)}
        onDismissInsight={() => setShowInsight(false)}
        onRefresh={handleRetry}
        onEndReached={handleLoadMore}
        scrollRef={scrollRef}
      />
      <CreateOrderFab
        colors={colors}
        shadows={shadows}
        onPress={() => router.push('/order/new')}
      />
      <OrdersModals
        showDatePicker={showDatePicker}
        showReportModal={showReportModal}
        dateRange={dateRange}
        dateRangeLabel={dateRangeLabel}
        orders={allOrders}
        businessName={merchant?.business_name || 'My Store'}
        logoUrl={merchant?.logo_url || undefined}
        onCloseDatePicker={() => setShowDatePicker(false)}
        onCloseReport={() => setShowReportModal(false)}
        onDateFilterSelect={handleDateFilterSelect}
        onDateRangeChange={setDateRange}
        onOpenDatePickerFromReport={openReportDatePicker}
      />
      <OrdersStatusDropdown
        visible={showStatusDropdown}
        selectedOrder={selectedOrder}
        dropdownPosition={dropdownPosition}
        colors={colors}
        shadows={shadows}
        isUpdating={updateStatus.isPending}
        getStatusActions={(status) => getStatusActions(colors, status)}
        onClose={closeStatusDropdown}
        onStatusUpdate={handleStatusUpdate}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
