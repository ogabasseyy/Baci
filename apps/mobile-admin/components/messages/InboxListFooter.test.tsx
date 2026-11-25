import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { InboxListFooter } from './InboxListFooter';

function renderFooter(
  state: { loading?: boolean; failed?: boolean; canLookBack?: boolean } = {}
) {
  const onLoadMore = vi.fn();
  const view = render(
    <InboxListFooter
      canLookBack={state.canLookBack ?? false}
      colors={LIGHT_COLORS}
      failed={state.failed ?? false}
      loading={state.loading ?? false}
      onLoadMore={onLoadMore}
    />
  );
  return { ...view, onLoadMore };
}

describe('InboxListFooter', () => {
  it('shows nothing when there is nothing to say', () => {
    const { container } = renderFooter();
    expect(container).toBeEmptyDOMElement();
  });

  it('offers no button while a page is loading', () => {
    renderFooter({ loading: true, failed: true, canLookBack: true });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers a retry after a failed page', () => {
    const { onLoadMore } = renderFooter({ failed: true, canLookBack: true });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Could not load more chats. Tap to retry.',
      })
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('offers older chats on request', () => {
    const { onLoadMore } = renderFooter({ canLookBack: true });
    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
