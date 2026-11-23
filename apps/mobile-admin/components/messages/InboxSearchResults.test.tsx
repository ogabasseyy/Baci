import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ router: { push: mocks.push } }));

import { InboxSearchResults } from './InboxSearchResults';

const chat = (id: number, name: string): InboxConversation => ({
  id,
  status: 'open',
  unreadCount: 0,
  customerName: name,
  lastActivityAt: null,
  lastMessage: null,
});

function renderResults(
  props: Partial<React.ComponentProps<typeof InboxSearchResults>> = {}
) {
  const onRetry = vi.fn();
  const onLoadMore = vi.fn();
  render(
    <InboxSearchResults
      colors={LIGHT_COLORS}
      hasMore={false}
      isError={false}
      isLoadingMore={false}
      isPending={false}
      loadMoreFailed={false}
      onLoadMore={onLoadMore}
      onRetry={onRetry}
      results={[]}
      term="order"
      {...props}
    />
  );
  return { onRetry, onLoadMore };
}

beforeEach(() => vi.clearAllMocks());

describe('InboxSearchResults', () => {
  it('asks for at least two letters before searching', () => {
    renderResults({ term: 'a' });
    expect(
      screen.getByText('Type at least 2 letters to search names and messages.')
    ).toBeInTheDocument();
  });

  it('shows no results or empty message while a search is running', () => {
    renderResults({ isPending: true });
    expect(screen.queryByText(/No chats match/)).toBeNull();
  });

  it('offers a retry when the search fails', () => {
    const { onRetry } = renderResults({ isError: true });

    fireEvent.click(screen.getByRole('button', { name: 'Tap to retry' }));

    expect(
      screen.getByText('Search is not available right now.')
    ).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing matches', () => {
    renderResults({ term: '  zebra ' });
    expect(screen.getByText('No chats match "zebra"')).toBeInTheDocument();
  });

  it('lists matches with the matching words and opens the tapped chat', () => {
    renderResults({
      results: [
        {
          conversation: chat(8, 'Zed Test'),
          snippet: 'where is my order 1234',
        },
        { conversation: chat(9, 'Yan Test'), snippet: null },
      ],
    });

    expect(screen.getByText('where is my order 1234')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Zed Test/ }));

    expect(mocks.push).toHaveBeenCalledWith('/(admin)/messages/8');
    expect(screen.getByText('Yan Test')).toBeInTheDocument();
  });

  it('bugfix: lets the owner keep looking when the pages so far had no match', () => {
    const { onLoadMore } = renderResults({ hasMore: true, term: 'zebra' });

    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }));

    expect(screen.getByText('No chats match "zebra"')).toBeInTheDocument();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('offers no way back when there is nothing more to search, or one is loading', () => {
    renderResults({ hasMore: false });
    expect(
      screen.queryByRole('button', { name: 'Look further back' })
    ).toBeNull();
  });

  it('hides the button while the next page is loading', () => {
    renderResults({ hasMore: true, isLoadingMore: true });
    expect(
      screen.queryByRole('button', { name: 'Look further back' })
    ).toBeNull();
  });

  it('bugfix: offers a retry under the results when the next page failed', () => {
    const { onRetry } = renderResults({
      loadMoreFailed: true,
      results: [{ conversation: chat(8, 'Zed Test'), snippet: null }],
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Could not load more chats. Tap to retry.',
      })
    );

    expect(screen.getByText('Zed Test')).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
