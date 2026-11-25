import type { ReactNode } from 'react';

/** Stand-in for FlashList that renders header, rows, empty state and footer. */
export function FlashListMock({
  data = [],
  keyExtractor,
  ListEmptyComponent,
  ListHeaderComponent,
  ListFooterComponent,
  onEndReached,
  onScrollBeginDrag,
  keyboardShouldPersistTaps,
  renderItem,
}: {
  data?: unknown[];
  keyExtractor?: (item: unknown, index: number) => string;
  ListEmptyComponent?: ReactNode;
  ListHeaderComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  onEndReached?: () => void;
  onScrollBeginDrag?: () => void;
  keyboardShouldPersistTaps?: string;
  renderItem: (input: { index: number; item: unknown }) => ReactNode;
}) {
  return (
    <div
      data-keyboard-taps={keyboardShouldPersistTaps ?? 'never'}
      data-testid="flash-list"
    >
      {ListHeaderComponent}
      {data.length === 0
        ? ListEmptyComponent
        : data.map((item, index) => (
            <div
              key={
                keyExtractor ? keyExtractor(item, index) : JSON.stringify(item)
              }
            >
              {renderItem({ item, index })}
            </div>
          ))}
      {ListFooterComponent}
      {onScrollBeginDrag ? (
        <button onClick={onScrollBeginDrag} type="button">
          List dragged (test)
        </button>
      ) : null}
      {onEndReached ? (
        <button onClick={onEndReached} type="button">
          List end reached (test)
        </button>
      ) : null}
    </div>
  );
}

export const conversation = (
  id: number,
  name: string,
  sender: 'customer' | 'store'
) => ({
  id,
  status: 'open' as const,
  unreadCount: sender === 'customer' ? 2 : 0,
  customerName: name,
  lastActivityAt: new Date().toISOString(),
  lastMessage: {
    id: id * 10,
    sender,
    kind: 'text' as const,
    text: `Hello from ${name}`,
    createdAt: new Date().toISOString(),
  },
});

/** A loaded conversations query, as `useInboxConversations` returns it. */
export const readyQuery = (
  conversations: ReturnType<typeof conversation>[],
  fns: { fetchNextPage: () => unknown; refetch: () => unknown }
) => ({
  data: { pages: [{ conversations, hasMore: false, page: 1 }] },
  error: null,
  fetchNextPage: fns.fetchNextPage,
  hasNextPage: false,
  isError: false,
  isFetchingNextPage: false,
  isLoading: false,
  refetch: fns.refetch,
});

/** A search with nothing typed: the default for every screen test. */
export const idleSearch = (loadMore: () => unknown, retry: () => unknown) => ({
  hasMore: false,
  isError: false,
  isLoadingMore: false,
  isPending: false,
  loadMore,
  loadMoreFailed: false,
  retry,
  results: [],
});
