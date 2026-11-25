import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./chat-order-actions', () => ({
  ChatOrderActions: ({
    merchantSlug,
    onContinueApplication,
  }: {
    merchantSlug: string;
    onContinueApplication: (orderId: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onContinueApplication(`order-for-${merchantSlug}`)}
    >
      Continue {merchantSlug}
    </button>
  ),
}));

import { ChatwootOrdersPanel } from './chatwoot-orders-panel';

describe('ChatwootOrdersPanel', () => {
  let holder: HTMLDivElement;
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    frame = document.createElement('iframe');
    frame.id = 'chatwoot_live_chat_widget';
    frame.inert = false;
    holder.appendChild(frame);
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
  });

  it('portals into #cw-widget-holder, marks widget inert, and closes on back or Escape', () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { unmount } = render(
      <ChatwootOrdersPanel
        storeSlug="ogabassey"
        onClose={onClose}
        onContinueApplication={onContinue}
      />
    );

    expect(frame.inert).toBe(true);
    expect(screen.getByRole('heading', { name: 'Your orders' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue ogabassey' }));
    expect(onContinue).toHaveBeenCalledWith('order-for-ogabassey');

    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(frame.inert).toBe(false);
  });
});
