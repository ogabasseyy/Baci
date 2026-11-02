import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockBuildSiblings, mockIsLegacy, mockIsTrusted } = vi.hoisted(() => ({
  mockBuildSiblings: vi.fn(),
  mockIsLegacy: vi.fn(),
  mockIsTrusted: vi.fn(),
}));

vi.mock('@/lib/blog-inline-image-optimization', () => ({
  buildInlineImageSiblings: (...args: unknown[]) => mockBuildSiblings(...args),
  isLegacyOgabasseyCdnBlogImage: (...args: unknown[]) => mockIsLegacy(...args),
  isTrustedCdnInlineImage: (...args: unknown[]) => mockIsTrusted(...args),
}));

import { BlogImageNodeRenderer } from './blog-image-node-renderer';

const IMAGE_SRC = 'https://cdn.example.com/photo.png';

describe('BlogImageNodeRenderer', () => {
  it('renders untrusted images through next/image', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(false);

    render(
      <BlogImageNodeRenderer
        node={{ type: 'image', attrs: { src: IMAGE_SRC, alt: 'A photo' } }}
        nodePath="0.1"
      />
    );

    expect(screen.getByRole('img', { name: 'A photo' })).toBeInTheDocument();
  });

  it('renders nothing for nodes without a valid http src', () => {
    const { container } = render(
      <BlogImageNodeRenderer
        node={{ type: 'image', attrs: { src: 'javascript:alert(1)' } }}
        nodePath="0.1"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders content-addressed release media without dropping it', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(false);
    const stableSrc = `/release-assets/${'b'.repeat(64)}.webp`;

    render(
      <BlogImageNodeRenderer
        node={{ type: 'image', attrs: { src: stableSrc, alt: 'Release' } }}
        nodePath="0.1"
      />
    );

    expect(screen.getByRole('img', { name: 'Release' })).toBeInTheDocument();
  });

  it('drops legacy ogabassey CDN blog images', () => {
    mockIsLegacy.mockReturnValue(true);

    const { container } = render(
      <BlogImageNodeRenderer
        node={{ type: 'image', attrs: { src: IMAGE_SRC } }}
        nodePath="0.1"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('serves trusted inline images via picture with priority when matched', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(true);
    mockBuildSiblings.mockReturnValue({
      avifSrcSet: `${IMAGE_SRC} 1x`,
      webpSrcSet: `${IMAGE_SRC} 1x`,
      fallback: IMAGE_SRC,
      fallbackSrcSet: `${IMAGE_SRC} 1x`,
      sizes: '100vw',
      width: 800,
      height: 450,
    });

    render(
      <BlogImageNodeRenderer
        node={{ type: 'image', attrs: { src: IMAGE_SRC, alt: 'Inline' } }}
        nodePath="0.1"
        priorityInlineImage={{ src: IMAGE_SRC, nodePath: '0.1' }}
      />
    );

    const img = screen.getByRole('img', { name: 'Inline' });
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('loading', 'eager');
  });

  it('renders a figure with caption when a title is present', () => {
    mockIsLegacy.mockReturnValue(false);
    mockIsTrusted.mockReturnValue(false);

    render(
      <BlogImageNodeRenderer
        node={{
          type: 'image',
          attrs: { src: IMAGE_SRC, title: 'Camera sample' },
        }}
        nodePath="0.1"
      />
    );

    expect(screen.getByText('Camera sample').tagName).toBe('FIGCAPTION');
  });
});
