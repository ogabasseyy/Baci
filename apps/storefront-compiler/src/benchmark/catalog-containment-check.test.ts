import { describe, expect, it } from 'vitest';
import {
  isContainedPublicCatalogJson,
  isContainedStorefrontHtml,
} from './catalog-containment-check';

describe('catalog-containment-check', () => {
  it('accepts allowlisted public catalog payloads and rejects private fields or unprojected keys', () => {
    const cleanJson = JSON.stringify({
      merchantId: 'm1',
      generation: 1,
      availabilityGeneration: 1,
      product: null,
    });
    expect(isContainedPublicCatalogJson(cleanJson)).toBe(true);
    expect(
      isContainedPublicCatalogJson(
        JSON.stringify({
          merchantId: 'm1',
          generation: 1,
          availabilityGeneration: 1,
          product: null,
          costPriceNgn: 100,
        })
      )
    ).toBe(false);

    const cleanState = JSON.stringify({
      view: 'home',
      pathname: '/',
      workerOrigin: 'https://w.test',
      merchantSlug: 'ogabassey',
      title: 'Home',
      products: [],
      facets: { brands: [], conditions: [], totalMatches: 0 },
      productDetail: null,
      publicDataRevision: '1:1',
    });
    expect(
      isContainedStorefrontHtml(
        `<html><body><script id="__BACI_STOREFRONT_STATE__" type="application/json">${cleanState}</script></body></html>`,
        200
      )
    ).toBe(true);
    expect(isContainedStorefrontHtml('<html>error</html>', 500)).toBe(true);
    expect(isContainedStorefrontHtml('<html>missing state</html>', 200)).toBe(
      false
    );
  });
});
