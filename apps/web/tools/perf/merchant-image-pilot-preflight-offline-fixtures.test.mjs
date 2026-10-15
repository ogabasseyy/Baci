import { describe, expect, it } from 'vitest';
import {
  MERCHANT,
  offlineOptions,
  RECIPE,
  setupOffline,
  setupOfflineAssets,
} from './merchant-image-pilot-preflight-offline-fixtures.mjs';

describe('merchant-image-pilot-preflight-offline-fixtures', () => {
  it('creates a valid single-asset offline fixture and option map', async () => {
    const fixture = await setupOffline();
    expect(fixture.generationId).toHaveLength(64);
    expect(fixture.tiers).toHaveLength(6);
    expect(fixture.assets[0].merchantId).toBe(MERCHANT);

    const options = offlineOptions(fixture, { recipe: 'custom' });
    expect(options.inventory).toBe(fixture.inventoryPath);
    expect(options.acceptances).toBe(fixture.acceptancesPath);
    expect(options.expectSample).toBe(fixture.samplePath);
    expect(options.recipe).toBe('custom');
    expect(RECIPE).toBeDefined();
  });

  it('stages multiple assets with setupOfflineAssets', async () => {
    const fixture = await setupOfflineAssets([
      {
        assetId: 'hero-1',
        ladder: [384],
        role: 'hero',
        slot: 'mobile-hero-slide-0',
        url: 'https://cdn.example.com/media/hero-1.png',
      },
    ]);
    expect(fixture.assets).toHaveLength(1);
    expect(fixture.assets[0].role).toBe('hero');
    expect(fixture.assets[0].stagedOriginal).toContain('hero-1.png');
  });
});
