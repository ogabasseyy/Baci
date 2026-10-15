import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PilotLabPictureMount } from './lab-picture-mount';
import type { ProjectedPilotImage } from './next-image-adapter';

const projection: ProjectedPilotImage = {
  alt: 'Store logo',
  fallbackSrc: '/__pilot/tiers/192.webp',
  fetchPriority: 'auto',
  height: 48,
  loading: 'eager',
  sizes: '40px',
  sources: [
    { format: 'avif', srcSet: '/__pilot/tiers/96.avif 96w' },
    { format: 'webp', srcSet: '/__pilot/tiers/96.webp 96w' },
  ],
  width: 48,
};

describe('PilotLabPictureMount', () => {
  it('renders a picture element with typed sources and fallback img attributes', () => {
    const html = renderToStaticMarkup(
      <PilotLabPictureMount arm="pilot" projection={projection} />
    );
    expect(html).toContain('data-pilot-lab-picture="pilot"');
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('src="/__pilot/tiers/192.webp"');
    expect(html).toContain('alt="Store logo"');
  });
});
