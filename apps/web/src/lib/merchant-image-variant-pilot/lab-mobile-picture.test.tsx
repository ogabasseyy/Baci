import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PilotLabMobilePicture } from './lab-mobile-picture';
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

describe('PilotLabMobilePicture', () => {
  it('renders AVIF and fallback sources with fit classes and honors null type override', () => {
    const pilotHtml = renderToStaticMarkup(
      <PilotLabMobilePicture arm="pilot" projection={projection} />
    );
    expect(pilotHtml).toContain('data-pilot-lab-picture="pilot"');
    expect(pilotHtml).toContain('type="image/avif"');
    expect(pilotHtml).toContain('object-contain object-right');

    const controlHtml = renderToStaticMarkup(
      <PilotLabMobilePicture
        arm="control"
        projection={{ ...projection, imageFit: 'cover' }}
        type={null}
      />
    );
    expect(controlHtml).toContain('data-pilot-lab-picture="control"');
    expect(controlHtml).not.toContain('type="image/avif"');
    expect(controlHtml).toContain('object-cover');
  });
});
