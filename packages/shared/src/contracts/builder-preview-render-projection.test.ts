import { describe, expect, it } from 'vitest';
import { previewRenderProjection } from './builder-preview-render-projection';

describe('preview render projection', () => {
  it('accepts static local image assets but rejects application and API routes', () => {
    expect(previewRenderProjection.isAssetSource('/assets/hero.webp')).toBe(
      true
    );
    expect(previewRenderProjection.isAssetSource('/media/hero.avif')).toBe(
      true
    );
    expect(
      previewRenderProjection.isAssetSource('/avatars/customer.webp')
    ).toBe(true);
    expect(
      previewRenderProjection.isAssetSource('/api/storefront/auth/session')
    ).toBe(false);
    expect(
      previewRenderProjection.isAssetSource('/api/tracker/pixel.png')
    ).toBe(false);
    expect(previewRenderProjection.isAssetSource('/dashboard/settings')).toBe(
      false
    );
    expect(
      previewRenderProjection.isAssetSource(
        '/images/../../api/llm/store/logo.png'
      )
    ).toBe(false);
    expect(
      previewRenderProjection.isAssetSource('/images/%2e%2e/api/logo.png')
    ).toBe(false);
  });

  it('removes external assets and replaces known refused blocks with inert placeholders', () => {
    const result = previewRenderProjection.projectCandidate({
      content: [
        {
          props: {
            id: 'header-1',
            logoUrl: 'https://cdn.example.test/logo.webp',
          },
          type: 'Header',
        },
        {
          props: { code: '<script>ignored()</script>', id: 'code-1' },
          type: 'CodeEmbed',
        },
      ],
      root: { props: { title: 'Home' } },
    });

    expect(result.content).toEqual([
      { props: { id: 'header-1' }, type: 'Header' },
      {
        props: { id: 'code-1', label: 'CodeEmbed section' },
        type: 'PreviewPlaceholder',
      },
    ]);
  });
});
