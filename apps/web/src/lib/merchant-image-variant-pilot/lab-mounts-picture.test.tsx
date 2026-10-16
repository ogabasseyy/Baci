import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovedPilotTier } from './lab-index';
import { PilotLabNotOptimized } from './lab-not-optimized';
import { PilotLabPictureMount } from './lab-picture-mount';
import {
  projectControlNextImage,
  projectPilotNextImage,
} from './next-image-adapter';

const GENERATION_ID = 'a'.repeat(64);

function tiers(): ApprovedPilotTier[] {
  const rows: ApprovedPilotTier[] = [];
  for (const width of [96, 192, 384]) {
    for (const format of ['avif', 'webp'] as const) {
      rows.push({
        actualWidth: width,
        bytes: 1000 + width,
        contentType: `image/${format}`,
        delivery: 'generated',
        fileName: `tier-${width}.${format}`,
        format,
        generationId: GENERATION_ID,
        height: Math.round((width * 3) / 4),
        quality: 70,
        requestedWidth: width,
        sha256: 'b'.repeat(64),
        width,
      });
    }
  }
  return rows;
}

describe('PilotLabPictureMount', () => {
  const slot = {
    alt: 'Lab product',
    height: 288,
    sizes: '50vw',
    width: 384,
  };

  it('renders typed pilot sources and a bare honest control img', () => {
    const pilot = projectPilotNextImage({
      baseUrl: '/__pilot',
      slot,
      tiers: tiers(),
    });
    const control = projectControlNextImage({
      originalUrl: '/__pilot/originals/product.png',
      slot,
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const pilotHtml = renderToStaticMarkup(
      <PilotLabPictureMount arm="pilot" projection={pilot} />
    );
    const controlHtml = renderToStaticMarkup(
      <PilotLabPictureMount arm="control" projection={control} />
    );
    expect(pilotHtml).toMatch(/96w.*192w.*384w/s);
    expect(pilotHtml).toContain('type="image/avif"');
    // Format-honest control: no typed sources over original bytes — the
    // img fallback carries the original, so nothing mis-selects by type.
    expect(controlHtml.match(/<source /g)).toBe(null);
    expect(controlHtml).toContain('src="/__pilot/originals/product.png"');
    expect(controlHtml).not.toContain('type=');
  });
});

describe('PilotLabNotOptimized', () => {
  it('marks the binding slot as reported-not-optimized', () => {
    const html = renderToStaticMarkup(
      <PilotLabNotOptimized
        binding={{
          assetId: 'logo-a',
          merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20',
          originalUrl: 'https://cdn.example.com/media/logo-a.png',
          role: 'logo',
          slotId: 'header-logo',
          sourceSha256: '0'.repeat(64),
        }}
        reason="binding status &quot;missing-acceptance&quot;; excluded."
      />
    );
    expect(html).toContain('data-pilot-lab-status="not-optimized"');
    expect(html).toContain('data-pilot-lab-slot="header-logo"');
    expect(html).toContain('logo-a — not optimized');
  });
});
