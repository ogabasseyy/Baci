import { type RefObject, useRef } from 'react';
import type { OrdersViewState } from '@/lib/orders-view-state';
import { OrdersDateChip } from './OrdersDateChip';
import { OrdersList } from './OrdersList';
import { OrdersSearchHeader } from './OrdersSearchHeader';
import type {
  OrdersCountSnapshot,
  OrdersFilterKey,
  OrdersListOnScroll,
  OrdersListRenderItem,
  OrdersListRow,
  ThemeColors,
} from './types';

const INSIGHT_DISMISS_SCROLL_Y = 56;

interface OrdersScrollSurfaceProps {
  colors: ThemeColors;
  searchQuery: string;
  selectedFilter: OrdersFilterKey;
  counts: OrdersCountSnapshot | null | undefined;
  dateChipLabel: string | null;
  data: OrdersListRow[];
  isRefreshing: boolean;
  isFetchingNextPage: boolean;
  listViewState: OrdersViewState;
  renderItem: OrdersListRenderItem;
  onSearchChange: (value: string) => void;
  onFilterSelect: (filter: OrdersFilterKey) => void;
  onClearDate: () => void;
  onDismissInsight: () => void;
  onRefresh: () => void;
  onEndReached: () => void;
  scrollRef?: RefObject<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  } | null>;
}

export function OrdersScrollSurface({
  colors,
  searchQuery,
  selectedFilter,
  counts,
  dateChipLabel,
  data,
  isRefreshing,
  isFetchingNextPage,
  listViewState,
  renderItem,
  onSearchChange,
  onFilterSelect,
  onClearDate,
  onDismissInsight,
  onRefresh,
  onEndReached,
  scrollRef,
}: OrdersScrollSurfaceProps) {
  const hasDismissedInsight = useRef(false);

  const handleListScroll: OrdersListOnScroll = (event) => {
    const scrollY = event.nativeEvent.contentOffset.y;
    if (scrollY < INSIGHT_DISMISS_SCROLL_Y || hasDismissedInsight.current) {
      return;
    }

    hasDismissedInsight.current = true;
    onDismissInsight();
  };

  return (
    <>
      <OrdersSearchHeader
        colors={colors}
        searchQuery={searchQuery}
        selectedFilter={selectedFilter}
        counts={counts}
        onSearchChange={onSearchChange}
        onFilterSelect={onFilterSelect}
      />
      <OrdersDateChip
        label={dateChipLabel}
        colors={colors}
        onClear={onClearDate}
      />
      <OrdersList
        colors={colors}
        data={data}
        isRefreshing={isRefreshing}
        isFetchingNextPage={isFetchingNextPage}
        listViewState={listViewState}
        renderItem={renderItem}
        onScroll={handleListScroll}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        scrollRef={scrollRef}
      />
    </>
  );
}
