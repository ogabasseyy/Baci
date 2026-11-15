import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const scrollIntoView = vi.fn();
const original = Element.prototype.scrollIntoView;

/** Simulates the merchant's scroll position inside the thread. */
function scrollThreadTo(distanceFromBottom: number) {
  const scroller = screen.getByRole('list', { name: 'Messages' })
    .parentElement as HTMLElement;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 2_000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, value: 1_600 - distanceFromBottom },
  });
  fireEvent.scroll(scroller);
}

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

describe('ConversationThread scrolling', () => {
  it('follows a new message while the merchant is at the latest message', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    scrollIntoView.mockClear();
    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the place of a merchant reading history and offers a jump', async () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    scrollThreadTo(900);
    scrollIntoView.mockClear();

    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: /new messages/i })
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });

  it('always shows the reply the merchant just sent', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    scrollThreadTo(900);
    scrollIntoView.mockClear();
    rerender(
      <ConversationThread
        state="ready"
        messages={[message(1), message(2, 'store')]}
      />
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('clears the jump button once the merchant scrolls back down', () => {
    const { rerender } = render(
      <ConversationThread state="ready" messages={[message(1)]} />
    );
    scrollThreadTo(900);
    rerender(
      <ConversationThread state="ready" messages={[message(1), message(2)]} />
    );
    expect(
      screen.getByRole('button', { name: /new messages/i })
    ).toBeInTheDocument();
    scrollThreadTo(10);
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });
});
