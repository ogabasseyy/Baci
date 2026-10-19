import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PilotLabScannerLink } from './lab-scanner-link';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

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

describe('PilotLabScannerLink', () => {
  it('renders a preload link with binding metadata and optional type override', () => {
    const pilotHtml = renderToStaticMarkup(
      <PilotLabScannerLink
        arm="pilot"
        binding="merchant/hero-0"
        projection={projection}
      />
    );
    expect(pilotHtml).toContain('rel="preload"');
    expect(pilotHtml).toContain('data-pilot-lab-binding="merchant/hero-0"');
    expect(pilotHtml).toContain('data-pilot-lab-preload="pilot"');
    expect(pilotHtml).toContain('type="image/avif"');

    const controlHtml = renderToStaticMarkup(
      <PilotLabScannerLink
        arm="control"
        binding="merchant/hero-0"
        projection={projection}
        type={null}
      />
    );
    expect(controlHtml).toContain('data-pilot-lab-preload="control"');
    expect(controlHtml).not.toContain('type="image/avif"');
  });
});
