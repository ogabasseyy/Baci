import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MerchantInboxMessage } from '@/schemas/merchant-inbox';
import { ConversationThread } from './conversation-thread';

function message(
  id: number,
  sender: MerchantInboxMessage['sender'] = 'customer'
): MerchantInboxMessage {
  return {
    id,
    sender,
    kind: 'text',
    text: `message ${id}`,
    createdAt: '2026-11-15T06:00:00.000Z',
  };
}

const SCROLL_HEIGHT = 2_000;
const CLIENT_HEIGHT = 400;
const AT_BOTTOM = SCROLL_HEIGHT - CLIENT_HEIGHT;

/** Gives the thread scroller a layout and a tracked scroll position. */
function layoutThread() {
  const scroller = screen.getByRole('list', { name: 'Messages' })
    .parentElement as HTMLElement;
  let scrollTop = AT_BOTTOM;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: SCROLL_HEIGHT },
    clientHeight: { configurable: true, value: CLIENT_HEIGHT },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      // Browsers clamp scrollTop to the furthest scrollable position.
      set: (value: number) => {
        scrollTop = Math.min(value, AT_BOTTOM);
      },
    },
  });
  return {
    position: () => scrollTop,
    scrollTo(distanceFromBottom: number) {
      scrollTop = AT_BOTTOM - distanceFromBottom;
      fireEvent.scroll(scroller);
    },
  };
}

describe('ConversationThread scrolling', () => {
  it('follows a new message while the merchant is at the latest message', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    const thread = layoutThread();
    thread.scrollTo(20);
    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(thread.position()).toBe(AT_BOTTOM);
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the place of a merchant reading history and offers a jump', async () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    const thread = layoutThread();
    thread.scrollTo(900);

    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(thread.position()).toBe(AT_BOTTOM - 900);

    await userEvent.click(
      screen.getByRole('button', { name: /new messages/i })
    );
    expect(thread.position()).toBe(AT_BOTTOM);
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });

  it('jumps to the reply this browser just had accepted', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    const thread = layoutThread();
    thread.scrollTo(900);
    rerender(
      <ConversationThread
        state="ready"
        ownReplyId={2}
        messages={[message(1), message(2, 'store')]}
      />
    );
    expect(thread.position()).toBe(AT_BOTTOM);
  });

  it('does not jump for a store message sent from elsewhere', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    const thread = layoutThread();
    thread.scrollTo(900);
    rerender(
      <ConversationThread
        state="ready"
        ownReplyId={null}
        messages={[message(1), message(2, 'store')]}
      />
    );
    expect(thread.position()).toBe(AT_BOTTOM - 900);
    expect(
      screen.getByRole('button', { name: /new messages/i })
    ).toBeInTheDocument();
  });

  it('clears the jump button once the merchant scrolls back down', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    const thread = layoutThread();
    thread.scrollTo(900);
    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(
      screen.getByRole('button', { name: /new messages/i })
    ).toBeInTheDocument();
    thread.scrollTo(10);
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });

  it('moves only its own scroller, never the page', () => {
    const before = window.scrollY;
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    layoutThread();
    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(window.scrollY).toBe(before);
  });
});
