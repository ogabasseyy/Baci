import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LabStoreHeaderBar } from './lab-store-shells';
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

  it('preserves the arm on header commerce links', () => {
    for (const arm of ['pilot', 'control'] as const) {
      const html = renderToStaticMarkup(
        <LabStoreHeaderBar
          arm={arm}
          basePath="/pilot-lab/store/omnimart"
          layout="logo-left-nav-center"
          projection={arm === 'pilot' ? PROJECTION : null}
          stagedOriginal="http://localhost:3000/__pilot/originals/logo.png"
          storeName="Omnimart"
        />
      );
      expect(html).toContain(`?arm=${arm}`);
    }
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
