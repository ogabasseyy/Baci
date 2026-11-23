import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/storefront/checkout-auth-notification', () => ({
  notifyCheckoutAuthChanged: notifyMock,
}));

vi.mock('@/components/storefront/checkout-code-signin', () => ({
  CheckoutCodeSignin: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Complete sign-in
    </button>
  ),
}));

import { ChatwootSignInPanel } from './chatwoot-sign-in-panel';

describe('ChatwootSignInPanel', () => {
  let holder: HTMLDivElement;
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('portals sign-in UI, notifies auth change on success, and restores widget inert state', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { unmount } = render(
      <ChatwootSignInPanel
        storeSlug="ogabassey"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    expect(frame.inert).toBe(true);
    const completeBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Complete sign-in' })
    );
    fireEvent.click(completeBtn);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(frame.inert).toBe(false);
  });
});
