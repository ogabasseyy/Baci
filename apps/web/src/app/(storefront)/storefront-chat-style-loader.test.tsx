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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders no visible content and loads chat CSS when the deferred launcher mounts', async () => {
    const { container } = render(<StorefrontChatStyleLoader />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => {
      expect(mockChatCssImport.state.load).toHaveBeenCalledOnce();
    });
  });
});
