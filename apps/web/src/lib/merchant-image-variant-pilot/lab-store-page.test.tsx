import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PilotLabConfig } from './lab-config';
import { pilotLabFixtureProductSlugs } from './lab-fixture-product-slugs';
import { PilotLabStorePage } from './lab-store-page';
import { pilotLabStoreBySlug } from './lab-store-registry';

const MERCHANT = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';

function emptyConfig(): PilotLabConfig {
  return {
    baseUrl: '/__pilot',
    bindings: [],
    index: { entries: {} },
    originalUrlFor: () => null,
    stagedPaths: [],
    statuses: [],
  };
}

describe('PilotLabStorePage', () => {
  it('renders the store heading with its lab arm', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    const html = renderToStaticMarkup(
      <PilotLabStorePage
        arm="pilot"
        config={emptyConfig()}
        origin="http://localhost:3000"
        store={store}
      />
    );
    expect(html).toContain('Omnimart pilot lab (pilot)');
  });

  it('refuses to render slots without a binding instead of mixing arms', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    const html = renderToStaticMarkup(
      <PilotLabStorePage
        arm="control"
        config={emptyConfig()}
        origin="http://localhost:3000"
        store={store}
      />
    );
    expect(html).toContain('data-pilot-lab-status="missing-binding"');
    expect(html).toContain('data-pilot-lab-slot="header-logo"');
    expect(html).toContain('data-pilot-lab-slot="product-card"');
    expect(html).toContain(MERCHANT);
  });

  it('reports uncovered consumers explicitly instead of omitting them', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    const html = renderToStaticMarkup(
      <PilotLabStorePage
        arm="pilot"
        config={emptyConfig()}
        origin="http://localhost:3000"
        store={store}
      />
    );
    // No binding (mount gates skip it), but the status lands in the
    // served coverage reported rows and readiness slot geometry.
    expect(html).toContain('data-pilot-lab-slot="hero-banner"');
    expect(html).toContain('data-pilot-lab-status="uncovered-consumer"');
    expect(html).toContain('heroComponent.render');
  });

  it('keeps unaccepted bindings on the reported path', () => {
    const store = pilotLabStoreBySlug('squishyland');
    if (!store) {
      throw new Error('squishyland store is missing from the lab table');
    }
    const binding = {
      assetId: 'orphan-card',
      merchantId: 'ce33cde7-fb48-4a6e-9742-e8ed4e2d137f',
      originalUrl: 'https://cdn.example.com/media/orphan.png',
      role: 'product' as const,
      slotId: 'product-card',
      sourceSha256: 'd'.repeat(64),
    };
    const config: PilotLabConfig = {
      ...emptyConfig(),
      bindings: [binding],
      statuses: [{ binding, status: 'missing-acceptance' }],
    };
    const html = renderToStaticMarkup(
      <PilotLabStorePage
        arm="pilot"
        config={config}
        origin="http://localhost:3000"
        store={store}
      />
    );
    expect(html).toContain('data-pilot-lab-status="not-optimized"');
    expect(html).toContain('missing-acceptance');
  });

  it('enumerates exactly the fixture slugs the route serves', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    // Mounted card + three grid fillers (real href chain) + hero slides.
    // The route test renders actual cards and requires every linked slug
    // to 200, so this pin cannot drift from what browsers prefetch.
    expect([...pilotLabFixtureProductSlugs(store)].sort()).toEqual([
      'lab-filler-four',
      'lab-filler-three',
      'lab-filler-two',
      'lab-hero-slide-0',
      'lab-hero-slide-1',
      'omnimart-lab-product',
    ]);
  });
});
