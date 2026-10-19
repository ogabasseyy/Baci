import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PilotLabConfig } from './lab-config';
import { LabStoreHeroSection } from './lab-store-hero-section';
import { pilotLabStoreBySlug } from './lab-store-registry';

const BINDING = {
  assetId: 'hero-s0',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  originalUrl: 'https://cdn.example.com/media/hero.png',
  role: 'hero' as const,
  slotId: 'mobile-hero-slide-0',
  sourceSha256: 'd'.repeat(64),
};

function emptyConfig(): PilotLabConfig {
  return {
    baseUrl: '/__pilot',
    bindings: [BINDING],
    index: { entries: {} },
    originalUrlFor: () => null,
    stagedPaths: [],
    statuses: [],
  };
}

describe('LabStoreHeroSection', () => {
  it('keeps hash-mismatched bindings on the reported path', () => {
    const store = pilotLabStoreBySlug('ogabassey');
    if (!store) {
      throw new Error('ogabassey store is missing from the lab table');
    }
    const html = renderToStaticMarkup(
      <LabStoreHeroSection
        arm="pilot"
        basePath="/pilot-lab/store/ogabassey"
        config={emptyConfig()}
        status={{
          binding: BINDING,
          detail: 'output hash mismatch: tier.avif',
          status: 'hash-mismatch',
        }}
        store={store}
      />
    );
    expect(html).toContain('data-pilot-lab-status="not-optimized"');
    expect(html).toContain('hash-mismatch');
    expect(html).toContain('output hash mismatch: tier.avif');
  });

  it('refuses accepted bindings with nothing staged', () => {
    const store = pilotLabStoreBySlug('ogabassey');
    if (!store) {
      throw new Error('ogabassey store is missing from the lab table');
    }
    for (const arm of ['pilot', 'control'] as const) {
      const html = renderToStaticMarkup(
        <LabStoreHeroSection
          arm={arm}
          basePath="/pilot-lab/store/ogabassey"
          config={emptyConfig()}
          status={{ binding: BINDING, status: 'accepted' }}
          store={store}
        />
      );
      expect(html).toContain('data-pilot-lab-status="not-optimized"');
      expect(html).toContain('no staged tiers or verified original');
    }
  });
});
