import { describe, expect, it } from 'vitest';
import {
  offlineOptions,
  setupOffline,
  setupOfflineAssets,
  srcSetFor,
  storeLogoControlPage,
  storeLogoPilotPage,
} from './merchant-image-pilot-preflight-fixtures.mjs';

describe('merchant-image-pilot-preflight-fixtures', () => {
  it('stages offline assets, computes options, and builds store logo pages', async () => {
    const fixture = await setupOffline();
    expect(fixture.assets).toHaveLength(1);
    expect(fixture.generationId).toHaveLength(64);
    expect(fixture.tiers.length).toBeGreaterThan(0);

    const opts = offlineOptions(fixture, { extra: true });
    expect(opts.acceptances).toBe(fixture.acceptancesPath);
    expect(opts.inputRoot).toBe(fixture.inputRoot);
    expect(opts.extra).toBe(true);

    const [asset] = fixture.assets;
    const avifSrcSet = srcSetFor(asset, fixture.generationId, 'avif');
    expect(avifSrcSet).toContain(`/__pilot/${fixture.generationId}/`);
    expect(avifSrcSet).toContain('96w');

    const pilotHtml = storeLogoPilotPage({
      arm: 'pilot',
      asset,
      heroRow: '<section id="hero"></section>',
    });
    expect(pilotHtml).toContain('data-pilot-lab-arm="pilot"');
    expect(pilotHtml).toContain('data-pilot-lab-header-logo="true"');
    expect(pilotHtml).toContain('<section id="hero"></section>');

    const controlHtml = storeLogoControlPage({
      asset,
      heroRow: '<section id="hero"></section>',
    });
    expect(controlHtml).toContain('data-pilot-lab-arm="control"');
    expect(controlHtml).toContain(asset.stagedOriginal);
  });

  it('stages custom asset list via setupOfflineAssets', async () => {
    const custom = await setupOfflineAssets([
      {
        assetId: 'card-a',
        ladder: [120],
        role: 'card',
        slot: 'product-card-0',
        url: 'https://cdn.example.com/media/card-a.png',
      },
    ]);
    expect(custom.assets).toHaveLength(1);
    expect(custom.assets[0].assetId).toBe('card-a');
    expect(custom.assets[0].tiers).toHaveLength(2);
  });
});
