import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useChatwootInlineCartBridge: vi.fn(),
  stagingEnabled: vi.fn(() => false),
}));
vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: mocks.stagingEnabled,
}));

vi.mock('@/hooks/use-chatwoot-inline-cart-bridge', () => ({
  useChatwootInlineCartBridge: mocks.useChatwootInlineCartBridge,
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'store-a' }, basePath: '/store-a' }),
}));
vi.mock('./chat-order-actions', () => ({
  ChatOrderActions: () => <button type="button">View my orders</button>,
}));

vi.mock('@/components/payments/oxygen/OxygenApplicationDialog', () => ({
  OxygenApplicationDialog: ({ embedded, orderId }: { embedded: boolean; orderId: string }) =>
    embedded ? <p aria-label="Secure application order">{orderId}</p> : null,
}));

vi.mock('@/components/storefront/checkout-code-signin', () => ({
  CheckoutCodeSignin: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Complete sign in
    </button>
  ),
}));

import { ChatwootInlineCartBridge } from './chatwoot-inline-cart-bridge';

describe('ChatwootInlineCartBridge', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.stagingEnabled.mockReturnValue(false);
    document.body.innerHTML = '';
  });

  it('forwards tenant/widget props to the hook and unmounts without markup', () => {
    const view = render(
      <ChatwootInlineCartBridge
        storeSlug="store-a"
        widgetOrigin="https://chatwoot.example.com"
      />
    );

    expect(mocks.useChatwootInlineCartBridge).toHaveBeenCalledWith(
      'store-a',
      'https://chatwoot.example.com',
      false,
      undefined
    );
    expect(view.container).toBeEmptyDOMElement();

    view.unmount();
    expect(view.container).toBeEmptyDOMElement();
  });

  it('forwards the checkout flag to the hook', () => {
    render(
      <ChatwootInlineCartBridge
        storeSlug="store-a"
        widgetOrigin="https://chatwoot.example.com"
        checkoutEnabled
      />
    );

    expect(mocks.useChatwootInlineCartBridge).toHaveBeenCalledWith(
      'store-a',
      'https://chatwoot.example.com',
      true,
      undefined
    );
  });

  it('hosts the first-party application in the actual widget and can return to the conversation', async () => {
    mocks.stagingEnabled.mockReturnValue(true);
    const orderId = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
    const fetchContact = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        order: {
          id: orderId,
          payment_method: 'oxygen',
          customer_name: 'Ada Obi',
          customer_email: 'ada@example.com',
        },
      })
    );
    const holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    const widget = document.createElement('iframe');
    widget.id = 'chatwoot_live_chat_widget';
    holder.append(widget);
    document.body.append(holder);
    render(<ChatwootInlineCartBridge storeSlug="store-a" widgetOrigin="https://chatwoot.example.com" checkoutEnabled />);
    const open = mocks.useChatwootInlineCartBridge.mock.lastCall?.[3];
    act(() => open(`/payments/oxygen/${orderId}`));
    const card = within(holder).getByRole('region', { name: 'Ekaette secure application' });
    expect(await within(card).findByText(orderId)).toBeVisible();
    expect(fetchContact).toHaveBeenCalledWith(
      `/api/storefront/account/orders/${orderId}?merchantSlug=store-a`,
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(widget.inert).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }));
    expect(widget.inert).not.toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue secure application' }));
    expect(within(holder).getByRole('region', { name: 'Ekaette secure application' })).toBeVisible();
  });

  it('opens order tools only for the configured widget on the current storefront', () => {
    mocks.stagingEnabled.mockReturnValue(true);
    const holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    const widget = document.createElement('iframe');
    widget.id = 'chatwoot_live_chat_widget';
    holder.append(widget);
    document.body.append(holder);
    const origin = 'https://chatwoot.example.com';
    render(
      <ChatwootInlineCartBridge storeSlug="store-a" widgetOrigin={origin} checkoutEnabled />
    );

    const orderMessage = (source: Window | null, messageOrigin: string) =>
      fireEvent(window, new MessageEvent('message', {
        data: 'baci-ekaette-open-orders',
        origin: messageOrigin,
        source,
      }));
    orderMessage(widget.contentWindow, 'https://other.example.com');
    orderMessage(window, origin);
    expect(screen.queryByRole('button', { name: 'View my orders' })).toBeNull();

    orderMessage(widget.contentWindow, origin);
    expect(within(holder).getByRole('button', { name: 'View my orders' })).toBeVisible();
    fireEvent.click(within(holder).getByRole('button', { name: 'Back to conversation' }));
    expect(screen.queryByRole('button', { name: 'View my orders' })).toBeNull();
  });

  it('opens the sign-in panel inside the widget holder and notifies the widget on success', async () => {
    mocks.stagingEnabled.mockReturnValue(true);
    const holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    const widget = document.createElement('iframe');
    widget.id = 'chatwoot_live_chat_widget';
    holder.append(widget);
    document.body.append(holder);
    const origin = 'https://chatwoot.example.com';
    render(
      <ChatwootInlineCartBridge storeSlug="store-a" widgetOrigin={origin} checkoutEnabled />
    );

    const postMessage = vi.spyOn(widget.contentWindow!, 'postMessage');
    fireEvent(
      window,
      new MessageEvent('message', {
        data: 'baci-ekaette-checkout-sign-in',
        origin,
        source: widget.contentWindow,
      })
    );

    const panel = within(holder).getByRole('region', {
      name: 'Sign in to continue in Ekaette',
    });
    expect(panel).toBeVisible();
    expect(widget.inert).toBe(true);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Complete sign in' }));
    expect(postMessage).toHaveBeenCalledWith('baci-ekaette-checkout-signed-in', origin);
    expect(
      within(holder).queryByRole('region', { name: 'Sign in to continue in Ekaette' })
    ).toBeNull();
    expect(widget.inert).not.toBe(true);
  });

  it('enables inline checkout panels outside staging while keeping Oxygen gated to staging', () => {
    mocks.stagingEnabled.mockReturnValue(false);
    const holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    const widget = document.createElement('iframe');
    widget.id = 'chatwoot_live_chat_widget';
    holder.append(widget);
    document.body.append(holder);
    const origin = 'https://chatwoot.example.com';
    render(
      <ChatwootInlineCartBridge storeSlug="store-a" widgetOrigin={origin} checkoutEnabled />
    );

    fireEvent(
      window,
      new MessageEvent('message', {
        data: 'baci-ekaette-checkout-sign-in',
        origin,
        source: widget.contentWindow,
      })
    );
    expect(
      within(holder).getByRole('region', {
        name: 'Sign in to continue in Ekaette',
      })
    ).toBeVisible();

    expect(mocks.useChatwootInlineCartBridge.mock.lastCall?.[3]).toBeUndefined();
    expect(
      within(holder).queryByRole('region', { name: 'Ekaette secure application' })
    ).toBeNull();
  });

});
