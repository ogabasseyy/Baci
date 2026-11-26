import { describe, expect, it } from 'vitest';
import { formatPhase0MarkdownReport } from './cli';
import { generateOgabasseyBackingCatalog } from './ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from './outbound-data-plane';
import {
  runGenerationChurnBenchmarkAsync,
  runPhase0Benchmarks,
} from './run-phase0-benchmarks';

describe('Phase 0 workerd SSR, Outbound tenant binding, and generation-churn benchmarks', () => {
  it('denies unauthorized egress hosts, ignores spoofed tenant params, and strips cost_price', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const products = generateOgabasseyBackingCatalog(120);
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products,
    });

    const denied = await plane.handleOutboundFetch(
      new Request('https://evil.example/exfiltrate'),
      { merchantId, merchantSlug: 'ogabassey' },
      'single-generation'
    );
    expect(denied.status).toBe(403);

    const searchRes = await plane.handleOutboundFetch(
      new Request(
        'https://catalog.baci.internal/v1/search?category=smartphones&merchantId=victim-tenant'
      ),
      { merchantId, merchantSlug: 'ogabassey' },
      'single-generation'
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.headers.get('x-baci-tenant')).toBe(merchantId);
    expect(plane.telemetry.spoofedTenantIgnoredCount).toBe(1);

    const bodyText = await searchRes.text();
    expect(bodyText).not.toContain('costPriceNgn');
    expect(bodyText).not.toContain('SUP-LAGOS-');
    expect(searchRes.headers.get('x-baci-cache')).toBe('MISS');

    const secondHit = await plane.handleOutboundFetch(
      new Request(
        'https://catalog.baci.internal/v1/search?category=smartphones'
      ),
      { merchantId, merchantSlug: 'ogabassey' },
      'single-generation'
    );
    expect(secondHit.headers.get('x-baci-cache')).toBe('HIT');

    // Advance past 24h TTL so cached entry expires and reports MISS, not HIT.
    plane.advanceClockMs(86_400_001);
    const expiredRes = await plane.handleOutboundFetch(
      new Request(
        'https://catalog.baci.internal/v1/search?category=smartphones'
      ),
      { merchantId, merchantSlug: 'ogabassey' },
      'single-generation'
    );
    expect(expiredRes.headers.get('x-baci-cache')).toBe('MISS');
  });

  it('executes compiled Ogabassey User Worker inside workerd, enforces true 404s, and measures generation churn', async () => {
    const report = await runPhase0Benchmarks({
      warmCompileIterations: 5,
      warmSsrIterations: 6,
      productCount: 2000,
    });

    expect(report.catalogProductCount).toBe(2000);
    expect(report.compiler.workerGzipBytes).toBeLessThan(1024 * 1024);
    expect(report.compiler.clientGzipBytes).toBeLessThanOrEqual(150 * 1024);
    expect(report.compiler.cssGzipBytes).toBeLessThanOrEqual(50 * 1024);
    expect(report.compiler.derivedSigkillTimeoutMs).toBeGreaterThanOrEqual(
      5000
    );

    expect(report.workerdSsr.true404Verified).toBe(true);
    expect(report.workerdSsr.anonCostPriceContained).toBe(true);
    expect(report.workerdSsr.spoofedTenantBlocked).toBe(true);

    const notFoundRoute = report.workerdSsr.routes.find(
      (r) => r.route === '/unknown-category-slug'
    );
    expect(notFoundRoute?.expectedStatus).toBe(404);

    // Amendment 2 proof: across 96 unique listing+PDP URLs at 60 inventory writes/min,
    // single-generation suffers heavy cache churn every 15s while split-availability preserves >94% catalog cache hits!
    const singleAt60 = report.generationChurn.find(
      (c) =>
        c.inventoryWritesPerMinute === 60 && c.strategy === 'single-generation'
    );
    const splitAt60 = report.generationChurn.find(
      (c) =>
        c.inventoryWritesPerMinute === 60 && c.strategy === 'split-availability'
    );
    expect(singleAt60).toBeDefined();
    expect(splitAt60).toBeDefined();
    expect(splitAt60?.catalogCacheHitRatio ?? 0).toBeGreaterThan(94);
    expect(singleAt60?.catalogCacheHitRatio ?? 100).toBeLessThan(65);
    expect(splitAt60?.originCatalogRpcCalls ?? 999).toBeLessThan(
      singleAt60?.originCatalogRpcCalls ?? 0
    );

    const markdown = formatPhase0MarkdownReport(report);
    expect(markdown).toContain('Generation-Churn Write-Load Simulation');
  });

  it('shows identical >94% hit ratios at 0 writes/min for both strategies', async () => {
    const singleZero = await runGenerationChurnBenchmarkAsync({
      inventoryWritesPerMinute: 0,
      strategy: 'single-generation',
      productCount: 500,
    });
    const splitZero = await runGenerationChurnBenchmarkAsync({
      inventoryWritesPerMinute: 0,
      strategy: 'split-availability',
      productCount: 500,
    });

    expect(singleZero.catalogCacheHitRatio).toBeGreaterThanOrEqual(94);
    expect(splitZero.catalogCacheHitRatio).toBe(
      singleZero.catalogCacheHitRatio
    );
  });
});
