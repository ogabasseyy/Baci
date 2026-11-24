import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { INBOX_VIEWS, type InboxView } from '@/schemas/merchant-inbox';
import { INBOX_EMPTY_COPY, InboxEmptyState } from './InboxEmptyState';

function renderEmpty(
  props: Partial<React.ComponentProps<typeof InboxEmptyState>> = {}
) {
  const onLoadMore = vi.fn();
  render(
    <InboxEmptyState
      canLoadMore={false}
      colors={LIGHT_COLORS}
      loading={false}
      onLoadMore={onLoadMore}
      view="needs_reply"
      {...props}
    />
  );
  return { onLoadMore };
}

describe('InboxEmptyState', () => {
  it.each(
    INBOX_VIEWS.map((v) => v.value)
  )('has its own message for the %s view', (view) => {
    renderEmpty({ view: view as InboxView });
    expect(
      screen.getByText(INBOX_EMPTY_COPY[view as InboxView].title)
    ).toBeInTheDocument();
  });

  it('bugfix: the Customers view does not tell staff who can view orders that they need permission', () => {
    renderEmpty({ view: 'returning' });

    expect(screen.queryByText(/needs permission/)).toBeNull();
    expect(
      screen.getByText(/People without access to orders do not see any\./)
    ).toBeInTheDocument();
  });

  it('shows only a spinner, no message, while pages are loading by themselves', () => {
    renderEmpty({ loading: true, canLoadMore: true });
    expect(screen.queryByText('You are all caught up')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Look further back' })
    ).toBeNull();
  });

  it('bugfix: shows the empty message, not a spinner, once automatic loading stops', () => {
    renderEmpty({ loading: false, canLoadMore: true });
    expect(screen.getByText('You are all caught up')).toBeInTheDocument();
  });

  it('lets the person look further back on purpose when older chats may exist', () => {
    const { onLoadMore } = renderEmpty({ canLoadMore: true });

    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('offers no further look when there is nothing older', () => {
    renderEmpty({ canLoadMore: false });
    expect(
      screen.queryByRole('button', { name: 'Look further back' })
    ).toBeNull();
  });
});
