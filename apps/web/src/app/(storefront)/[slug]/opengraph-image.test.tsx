import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetCachedMerchant,
  mockGetCachedMerchantByDomain,
  mockImageResponse,
} = vi.hoisted(() => ({
  mockGetCachedMerchant: vi.fn(),
  mockGetCachedMerchantByDomain: vi.fn(),
  mockImageResponse: vi.fn(function ImageResponse(
    element: unknown,
    options: unknown
  ) {
    return { element, options };
  }),
}));

vi.mock('next/og', () => ({
  ImageResponse: mockImageResponse,
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: (...args: unknown[]) => mockGetCachedMerchant(...args),
  getCachedMerchantByDomain: (...args: unknown[]) =>
    mockGetCachedMerchantByDomain(...args),
}));

import Image, {
  alt,
  contentType,
  size,
} from '@/app/(storefront)/[slug]/opengraph-image';

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).join(' ');
  }
  if (typeof node === 'object' && 'props' in node) {
    return collectText(
      (node as { props: { children?: unknown } }).props.children
    );
  }
  return '';
}

function lastRender(): { text: string; options: unknown } {
  const call = mockImageResponse.mock.calls.at(-1);
  if (!call) throw new Error('ImageResponse was not called');
  return { text: collectText(call[0]), options: call[1] };
}

const merchant = {
  business_name: 'Oga & Bassey',
  site_tagline: 'Premium gadgets, delivered',
  site_description: '',
  logo_url: '',
  brand_colors: {
    primary: '#111111',
    background: '#222222',
    accent: '#333333',
  },
};

describe('[slug]/opengraph-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedMerchant.mockResolvedValue(null);
    mockGetCachedMerchantByDomain.mockResolvedValue(null);
  });

  it('exposes the store preview image contract', () => {
    expect(alt).toBe('Store Preview');
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
  });

  it('renders the store-not-found fallback at full size for unknown slugs', async () => {
    await Image({ params: Promise.resolve({ slug: 'no-such-store' }) });

    const { text, options } = lastRender();
    expect(text).toContain('Store Not Found');
    expect(options).toMatchObject({ width: 1200, height: 630 });
    expect(mockGetCachedMerchant).toHaveBeenCalledWith('no-such-store');
    expect(mockGetCachedMerchantByDomain).not.toHaveBeenCalled();
  });

  it('renders the merchant storefront image for a slug merchant', async () => {
    mockGetCachedMerchant.mockResolvedValue(merchant);

    await Image({ params: Promise.resolve({ slug: 'ogabassey' }) });

    const { text, options } = lastRender();
    expect(text).toContain('Oga & Bassey');
    expect(text).toContain('Premium gadgets, delivered');
    expect(options).toMatchObject({ width: 1200, height: 630 });
  });

  it('resolves custom domains through the domain lookup', async () => {
    mockGetCachedMerchantByDomain.mockResolvedValue(merchant);

    await Image({ params: Promise.resolve({ slug: 'ogabassey.com' }) });

    expect(mockGetCachedMerchantByDomain).toHaveBeenCalledWith('ogabassey.com');
    expect(mockGetCachedMerchant).not.toHaveBeenCalled();
    expect(lastRender().text).toContain('Oga & Bassey');
  });
});
