import { describe, expect, it } from 'vitest';
import {
  contentTypeFor,
  labHtml,
  MERCHANT,
  mountFor,
  notOptimizedSection,
  RECIPE,
  replaceHeroSection,
  serveStaged,
  setupOffline,
  sha256,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

describe('merchant-image-pilot-preflight-served-fixtures', () => {
  it('stages served fixtures, builds lab HTML, and serves staged files', async () => {
    expect(sha256(Buffer.from('test'))).toHaveLength(64);
    expect(MERCHANT).toBeDefined();
    expect(RECIPE).toBeDefined();
    expect(contentTypeFor('a.avif')).toBe('image/avif');
    expect(contentTypeFor('a.bin')).toBe('application/octet-stream');

    const fixture = await setupOffline();
    const [asset] = fixture.assets;
    const mount = mountFor(asset);
    expect(mount.binding).toBe(`${asset.merchantId}/${asset.assetId}`);

    const html = labHtml({
      arm: 'pilot',
      generationId: fixture.generationId,
      tiers: fixture.tiers,
    });
    expect(html).toContain('data-pilot-lab-arm="pilot"');

    const replaced = replaceHeroSection(
      html,
      notOptimizedSection(`${MERCHANT}/hero-s0`, 'mobile-hero-slide-0')
    );
    expect(replaced).toContain('data-pilot-lab-status="not-optimized"');

    let status = 0;
    let body = null;
    const res = {
      writeHead(code) {
        status = code;
        return {
          end(payload) {
            body = payload;
          },
        };
      },
    };
    await serveStaged(res, fixture.publicDir, `${asset.stagedOriginal}?w=48`);
    expect(status).toBe(200);
    expect(Buffer.isBuffer(body)).toBe(true);
  });
});
