import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PilotLabConfig } from './lab-config';
import {
  LAB_GRID_FILLERS,
  LabStoreGridSection,
} from './lab-store-grid-section';
import { pilotLabStoreBySlug } from './lab-store-registry';

const BINDING = {
  assetId: 'card-1',
  merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20',
  originalUrl: 'https://cdn.example.com/media/card.png',
  role: 'product' as const,
  slotId: 'product-card',
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

describe('LabStoreGridSection', () => {
  it('freezes the grid filler bytes (hash-pinned, separate from any selected original)', () => {
    // Grid fillers render this committed synthetic asset — never a copy of
    // the selected binding's original — identically in both arms, so the
    // byte comparison isolates the selected slot.
    expect(LAB_GRID_FILLERS).toHaveLength(3);
    const here = dirname(fileURLToPath(import.meta.url));
    const fillerPath = join(
      here,
      '..',
      '..',
      '..',
      'public',
      '__pilot',
      'fillers',
      'grid-filler-600x400.png'
    );
    const bytes = readFileSync(fillerPath);
    expect(bytes.length).toBe(1312);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '91b03b97f2218feedf29edb7daa828ce0770d1aac6ba7d947a17c1bf6c5e415a'
    );
  });

  it('keeps rejected bindings on the reported path', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    const html = renderToStaticMarkup(
      <LabStoreGridSection
        arm="pilot"
        basePath="/pilot-lab/store/omnimart"
        config={emptyConfig()}
        origin="http://localhost:3000"
        status={{
          binding: BINDING,
          detail: 'owner said no',
          status: 'rejected',
        }}
        store={store}
      />
    );
    expect(html).toContain('data-pilot-lab-status="not-optimized"');
    expect(html).toContain('owner said no');
  });

  it('refuses accepted bindings with nothing staged', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    const html = renderToStaticMarkup(
      <LabStoreGridSection
        arm="control"
        basePath="/pilot-lab/store/omnimart"
        config={emptyConfig()}
        origin="http://localhost:3000"
        status={{ binding: BINDING, status: 'accepted' }}
        store={store}
      />
    );
    expect(html).toContain('data-pilot-lab-status="not-optimized"');
    expect(html).toContain('no staged tiers or original');
  });
});
