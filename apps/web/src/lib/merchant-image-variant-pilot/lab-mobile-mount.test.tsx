import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PilotLabMobileMount } from './lab-mobile-mount';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

type ReactDomModule = typeof import('react-dom');

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<ReactDomModule>();
  return { ...actual, preload: vi.fn() };
});

const projection: ProjectedOgabasseyMobile = {
  alt: 'Hero mobile slide',
  avifSrcSet: '/__pilot/384.avif 384w',
  fallbackSrcSet: '/__pilot/384.webp 384w',
  imageFit: 'contain',
  imgSrc: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  media: '(max-width: 768px)',
  preload: {
    fetchPriority: 'high',
    href: '/__pilot/384.avif',
    imageSizes: '40vw',
    imageSrcSet: '/__pilot/384.avif 384w',
    media: '(max-width: 768px)',
    type: 'image/avif',
  },
  sizes: '40vw',
};

describe('PilotLabMobileMount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts flight preload, scanner link, and mobile picture together', () => {
    const html = renderToStaticMarkup(
      <PilotLabMobileMount
        arm="pilot"
        binding="merchant/hero-1"
        projection={projection}
      />
    );
    expect(preload).toHaveBeenCalledOnce();
    expect(html).toContain('data-pilot-lab-preload="pilot"');
    expect(html).toContain('data-pilot-lab-picture="pilot"');
    expect(html).toContain('data-pilot-lab-binding="merchant/hero-1"');
  });
});
