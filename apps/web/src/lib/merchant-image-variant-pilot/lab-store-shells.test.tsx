import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { labProductFixture } from './lab-card-clone';
import { LabStoreGrid, LabStoreHeaderBar } from './lab-store-shells';
import type { ProjectedPilotImage } from './next-image-adapter';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const PROJECTION = {
  fallbackSrc: 'http://localhost:3000/__pilot/abc/tier.webp',
  preload: {
    fetchPriority: 'high',
    href: 'http://localhost:3000/__pilot/abc/tier.webp',
    imageSizes: '40px',
    imageSrcSet: 'http://localhost:3000/__pilot/abc/tier.webp 40w',
  },
  sources: [],
} as unknown as ProjectedPilotImage;

describe('LabStoreHeaderBar', () => {
  it('mounts the lab clone on pilot and the original on control', () => {
    const pilot = renderToStaticMarkup(
      <LabStoreHeaderBar
        arm="pilot"
        basePath="/pilot-lab/store/omnimart"
        layout="logo-left-nav-center"
        projection={PROJECTION}
        stagedOriginal="http://localhost:3000/__pilot/originals/logo.png"
        storeName="Omnimart"
      />
    );
    expect(pilot).toContain('data-pilot-lab-header-logo="true"');
    const control = renderToStaticMarkup(
      <LabStoreHeaderBar
        arm="control"
        basePath="/pilot-lab/store/omnimart"
        layout="logo-left-nav-center"
        projection={null}
        stagedOriginal="http://localhost:3000/__pilot/originals/logo.png"
        storeName="Omnimart"
      />
    );
    expect(control).not.toContain('data-pilot-lab-header-logo="true"');
    expect(control).toContain('data-pilot-lab-store-header="Omnimart"');
  });

  it('falls back to the original when the pilot projection is empty', () => {
    const html = renderToStaticMarkup(
      <LabStoreHeaderBar
        arm="pilot"
        basePath="/pilot-lab/store/omnimart"
        layout="logo-left-nav-center"
        projection={null}
        stagedOriginal="http://localhost:3000/__pilot/originals/logo.png"
        storeName="Omnimart"
      />
    );
    expect(html).not.toContain('data-pilot-lab-header-logo="true"');
  });
});

describe('LabStoreGrid', () => {
  const product = labProductFixture({
    imageHint: 'selected lab product',
    imageLarge: 'http://localhost:3000/__pilot/originals/selected.png',
    name: 'Selected Lab Product',
  });

  it('wraps the selected card for coverage identity in both arms', () => {
    for (const arm of ['pilot', 'control'] as const) {
      const html = renderToStaticMarkup(
        <LabStoreGrid
          arm={arm}
          basePath="/pilot-lab/store/omnimart"
          fillerImageUrls={[
            'http://localhost:3000/__pilot/fillers/grid-filler-600x400-a.png',
            'http://localhost:3000/__pilot/fillers/grid-filler-600x400-b.png',
            'http://localhost:3000/__pilot/fillers/grid-filler-600x400-c.png',
          ]}
          fillers={[]}
          mountedProduct={product}
          mountedProjection={arm === 'pilot' ? PROJECTION : null}
        />
      );
      expect(html).toContain('data-pilot-lab-selected-card="true"');
    }
  });

  it('never reuses the selected image for fillers', () => {
    const html = renderToStaticMarkup(
      <LabStoreGrid
        arm="pilot"
        basePath="/pilot-lab/store/omnimart"
        fillerImageUrls={[
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-a.png',
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-b.png',
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-c.png',
        ]}
        fillers={[{ imageHint: 'filler', name: 'Lab Filler Two', price: 1800 }]}
        mountedProduct={product}
        mountedProjection={PROJECTION}
      />
    );
    expect(html).toContain('grid-filler-600x400-a.png');
    // The filler card renders the frozen asset, not the selected binding.
    const [, afterSelected] = html.split('data-pilot-lab-selected-card="true"');
    expect(afterSelected).not.toContain('__pilot/originals/selected.png');
  });

  it('gives every sibling card a distinct filler URL (no request coalescing)', () => {
    const html = renderToStaticMarkup(
      <LabStoreGrid
        arm="pilot"
        basePath="/pilot-lab/store/omnimart"
        fillerImageUrls={[
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-a.png',
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-b.png',
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-c.png',
        ]}
        fillers={[
          { imageHint: 'filler two', name: 'Lab Filler Two', price: 1800 },
          { imageHint: 'filler three', name: 'Lab Filler Three', price: 3200 },
          { imageHint: 'filler four', name: 'Lab Filler Four', price: 4100 },
        ]}
        mountedProduct={product}
        mountedProjection={PROJECTION}
      />
    );
    // Siblings sharing one URL would coalesce into a single browser
    // request, understating contention on the selected priority card.
    for (const suffix of ['-a.png', '-b.png', '-c.png']) {
      expect(html).toContain(`grid-filler-600x400${suffix}`);
    }
  });

  it('scopes commerce hrefs under the lab base path', () => {
    const html = renderToStaticMarkup(
      <LabStoreGrid
        arm="control"
        basePath="/pilot-lab/store/omnimart"
        fillerImageUrls={[
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-a.png',
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-b.png',
          'http://localhost:3000/__pilot/fillers/grid-filler-600x400-c.png',
        ]}
        fillers={[]}
        mountedProduct={product}
        mountedProjection={null}
      />
    );
    expect(html).toContain('/pilot-lab/store/omnimart');
  });
});
