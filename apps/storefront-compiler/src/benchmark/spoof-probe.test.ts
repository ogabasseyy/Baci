import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import { compileStorefrontWorker } from '../compiler/compile-storefront';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from './ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from './outbound-data-plane';
import { verifySpoofedTenantBlocked } from './spoof-probe';

describe('spoof-probe', () => {
  it('verifies victim tenant sentinel data never leaks into spoofed storefront requests', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const trustedParams = { merchantId, merchantSlug: 'ogabassey' };
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products: generateOgabasseyBackingCatalog(40),
    });
    const compiled = await compileStorefrontWorker(
      createOgabasseyStorefrontManifest()
    );
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: async (req: MiniflareRequest) => {
        const res = await plane.handleOutboundFetch(
          new Request(req.url, { method: req.method }),
          trustedParams,
          'split-availability'
        );
        return new MiniflareResponse(await res.text(), {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
        });
      },
    });
    try {
      await expect(
        verifySpoofedTenantBlocked({
          spoofIsolate: mf,
          outboundPlane: plane,
          trustedParams,
        })
      ).resolves.toBe(true);
    } finally {
      await mf.dispose();
    }
  });
});
