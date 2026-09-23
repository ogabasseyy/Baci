import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBlogCssImport = vi.hoisted(() => {
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

vi.mock('@/app/(storefront)/storefront-core.css', () => ({}));
vi.mock('@/app/(storefront)/storefront-blog.css', mockBlogCssImport.factory);

import { StorefrontBlogStyleLoader } from './storefront-blog-style-loader';

describe('StorefrontBlogStyleLoader', () => {
  beforeEach(() => {
    mockBlogCssImport.state.load.mockClear();
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders no visible content and keeps the blog stylesheet off a mobile LCP path', () => {
    const { container } = render(<StorefrontBlogStyleLoader />);

    expect(container).toBeEmptyDOMElement();
    expect(mockBlogCssImport.state.load).not.toHaveBeenCalled();
  });

  it('loads the blog stylesheet after the first input on mobile', async () => {
    render(<StorefrontBlogStyleLoader />);
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockBlogCssImport.state.load).toHaveBeenCalledOnce();
    });
  });
});
