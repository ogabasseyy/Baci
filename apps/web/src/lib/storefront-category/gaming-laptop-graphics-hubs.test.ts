import { describe, expect, it } from 'vitest';
import {
  buildGamingLaptopGraphicsHubPath,
  buildHubPaginationBasePath,
  getAvailableGamingLaptopGraphicsHubs,
  getGamingLaptopGraphicsHub,
  getGraphicsOptionsForHub,
  resolveCarriedHubSlug,
} from './gaming-laptop-graphics-hubs';

describe('gaming laptop graphics hubs', () => {
  it('groups common base RTX spellings without mixing Ti models', () => {
    const hub = getGamingLaptopGraphicsHub('rtx-4070');
    expect(hub).not.toBeNull();
    if (!hub) throw new Error('Expected the curated RTX 4070 hub');

    expect(
      getGraphicsOptionsForHub(
        [
          '8GB RTX 4070 Graphics',
          'NVIDIA GeForce RTX 4070 8GB',
          'NVIDIA RTX 4070 Laptop GPU',
          'NVIDIA GeForce RTX 4070 Ti',
          'NVIDIA GeForce RTX 4070-Ti',
          'NVIDIA GeForce RTX 4070 (Ti)',
          'NVIDIA GeForce RTX 4070 / Super',
          'RTX 5070',
        ],
        hub
      )
    ).toEqual([
      '8GB RTX 4070 Graphics',
      'NVIDIA GeForce RTX 4070 8GB',
      'NVIDIA RTX 4070 Laptop GPU',
    ]);
  });

  it('only exposes curated hubs represented by current inventory options', () => {
    expect(
      getAvailableGamingLaptopGraphicsHubs([
        'RTX 4060 Laptop GPU',
        'NVIDIA RTX 5080 16GB',
        'RTX 5090',
      ]).map((hub) => hub.slug)
    ).toEqual(['rtx-4060', 'rtx-5080']);
  });

  it('builds a stable nested hub path', () => {
    expect(buildGamingLaptopGraphicsHubPath('gaming-laptops', 'rtx-4070')).toBe(
      '/gaming-laptops/graphics/rtx-4070'
    );
  });

  it('anchors hub pagination to the request-scoped storefront path', () => {
    expect(
      buildHubPaginationBasePath({
        baseUrl: 'http://localhost:3000/ogabassey',
        canonicalBaseUrl:
          'http://localhost:3000/ogabassey/gaming-laptops/graphics/rtx-4070',
        requestScopedBaseUrl: 'http://localhost:3000/ogabassey',
      })
    ).toBe('/ogabassey/gaming-laptops/graphics/rtx-4070');
  });

  it('drops the merchant prefix on custom-domain scopes', () => {
    expect(
      buildHubPaginationBasePath({
        baseUrl: 'https://ogabassey.com',
        canonicalBaseUrl:
          'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
        requestScopedBaseUrl: 'https://ogabassey.com',
      })
    ).toBe('/gaming-laptops/graphics/rtx-4070');
  });

  it('returns undefined without a hub canonical URL', () => {
    expect(
      buildHubPaginationBasePath({
        baseUrl: 'https://ogabassey.com',
        canonicalBaseUrl: undefined,
        requestScopedBaseUrl: 'https://ogabassey.com',
      })
    ).toBeUndefined();
  });

  it('carries a validated hub token forward for the next transition', () => {
    expect(
      resolveCarriedHubSlug({
        graphicsOptions: ['NVIDIA RTX 4070 8GB', 'RTX 4070 Laptop'],
        hubSlug: undefined,
        rawGraphics: ['NVIDIA RTX 4070 8GB'],
        trustedHubSlug: 'rtx-4070',
      })
    ).toBe('rtx-4070');
  });

  it('falls back to the hub context for unvalidated tokens', () => {
    expect(
      resolveCarriedHubSlug({
        graphicsOptions: ['NVIDIA RTX 4070 8GB'],
        hubSlug: 'rtx-4070',
        rawGraphics: ['Unknown GPU'],
        trustedHubSlug: 'rtx-4070',
      })
    ).toBe('rtx-4070');
    expect(
      resolveCarriedHubSlug({
        graphicsOptions: ['NVIDIA RTX 4070 8GB'],
        hubSlug: undefined,
        rawGraphics: ['NVIDIA RTX 4070 8GB'],
        trustedHubSlug: 'rtx-9999',
      })
    ).toBeUndefined();
  });
});
