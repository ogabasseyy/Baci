import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useChatwootInlineCartBridge: vi.fn(),
}));

vi.mock('@/hooks/use-chatwoot-inline-cart-bridge', () => ({
  useChatwootInlineCartBridge: mocks.useChatwootInlineCartBridge,
}));

import { ChatwootInlineCartBridge } from './chatwoot-inline-cart-bridge';

describe('ChatwootInlineCartBridge', () => {
  afterEach(() => {
    vi.clearAllMocks();
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
      'https://chatwoot.example.com'
    );
    expect(view.container).toBeEmptyDOMElement();

    view.unmount();
    expect(view.container).toBeEmptyDOMElement();
  });
});
