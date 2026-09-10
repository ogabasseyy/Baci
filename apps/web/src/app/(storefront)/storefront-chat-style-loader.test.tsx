import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockChatCssImport = vi.hoisted(() => {
  const state = {
    load: vi.fn(),
  };

  return {
    factory: () => {
      state.load();
      return {};
    },
    state,
  };
});

vi.mock('@/app/(storefront)/storefront-chat.css', mockChatCssImport.factory);

import { StorefrontChatStyleLoader } from './storefront-chat-style-loader';

describe('StorefrontChatStyleLoader', () => {
  beforeEach(() => {
    mockChatCssImport.state.load.mockClear();
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders no visible content and keeps chat CSS off a mobile LCP path', () => {
    const { container } = render(<StorefrontChatStyleLoader />);

    expect(container).toBeEmptyDOMElement();
    expect(mockChatCssImport.state.load).not.toHaveBeenCalled();
  });

  it('loads the chat stylesheet after the first input on mobile', async () => {
    render(<StorefrontChatStyleLoader />);
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockChatCssImport.state.load).toHaveBeenCalledOnce();
    });
  });
});
