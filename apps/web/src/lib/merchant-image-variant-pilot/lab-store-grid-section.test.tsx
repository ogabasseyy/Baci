import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PilotLabConfig } from './lab-config';
import { PILOT_LAB_FILLER_IMAGES } from './lab-fixtures';
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
  it('freezes one grid filler per sibling card (hash-pinned, separate from any selected original)', () => {
    // Grid fillers render committed synthetic assets — never a copy of
    // the selected binding's original — identically in both arms, so the
    // byte comparison isolates the selected slot. One DISTINCT asset per
    // sibling: shared URLs would coalesce into a single browser request.
    expect(LAB_GRID_FILLERS).toHaveLength(3);
    expect(PILOT_LAB_FILLER_IMAGES).toHaveLength(LAB_GRID_FILLERS.length);
    const here = dirname(fileURLToPath(import.meta.url));
    const pinned: Record<string, { bytes: number; sha256: string }> = {
      'grid-filler-600x400-a.png': {
        bytes: 12535,
        sha256:
          '6ef0972498624161834c3fe6cba5dbf047f3ca536d272ebcc6545b18cda5f83a',
      },
      'grid-filler-600x400-b.png': {
        bytes: 12769,
        sha256:
          '092ad111e2f8680afc232ad66813d23e831dbf73d334bc104d9db52f61138a86',
      },
      'grid-filler-600x400-c.png': {
        bytes: 14566,
        sha256:
          'a6d5d0159f63ef07a8bc25aae2a189e47263ddc12129b46659c1707c8b04ac61',
      },
    };
    for (const asset of PILOT_LAB_FILLER_IMAGES) {
      const file = asset.split('/').pop() ?? '';
      const pin = pinned[file];
      if (!pin) {
        throw new Error(`filler asset ${asset} is not hash-pinned`);
      }
      const bytes = readFileSync(
        join(here, '..', '..', '..', 'public', '__pilot', 'fillers', file)
      );
      expect(bytes.length).toBe(pin.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);
    }
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
