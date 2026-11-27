import { generateOgabasseyBackingCatalog } from './ogabassey-catalog-fixture';
import {
  type CacheKeyStrategy,
  SimulatedPostgrestOutboundPlane,
  type TrustedOutboundParams,
} from './outbound-data-plane';

export interface ChurnScenarioMetrics {
  inventoryWritesPerMinute: number;
  strategy: CacheKeyStrategy;
  totalRequests: number;
  writeCount: number;
  catalogCacheHitRatio: number;
  originGenerationReads: number;
  originCatalogRpcCalls: number;
  originAvailabilityRpcCalls: number;
}

function buildRealisticStorefrontTrafficPool(
  products: ReturnType<typeof generateOgabasseyBackingCatalog>
): string[] {
  const hotRoutes = [
    'https://catalog.baci.internal/v1/search?limit=12',
    'https://catalog.baci.internal/v1/search?category=smartphones',
    'https://catalog.baci.internal/v1/search?category=laptops',
    'https://catalog.baci.internal/v1/search?category=gaming',
    'https://catalog.baci.internal/v1/search?q=iphone&brand=Apple',
    'https://catalog.baci.internal/v1/search?q=galaxy&brand=Samsung',
  ];
  const longTailRoutes = products
    .filter((p) => p.isPublished)
    .slice(0, 90)
    .map(
      (p) =>
        `https://catalog.baci.internal/v1/product?category=${p.categorySlug}&productSlug=${p.slug}`
    );

  // Realistic 40% hot listing traffic / 60% long-tail PDP traffic across 180s (1,800 reqs).
  // Separate cursors ensure all 6 listing routes + all 90 PDP routes (96 distinct URLs) execute.
  const schedule: string[] = [];
  let hotCursor = 0;
  let pdpCursor = 0;
  for (let i = 0; i < 1800; i++) {
    if (i % 5 < 2) {
      schedule.push(hotRoutes[hotCursor % hotRoutes.length] ?? hotRoutes[0]);
      hotCursor += 1;
    } else {
      schedule.push(
        longTailRoutes[pdpCursor % longTailRoutes.length] ?? hotRoutes[0]
      );
      pdpCursor += 1;
    }
  }
  return schedule;
}

export async function runGenerationChurnBenchmarkAsync(options: {
  inventoryWritesPerMinute: number;
  strategy: CacheKeyStrategy;
  productCount?: number;
}): Promise<ChurnScenarioMetrics> {
  const merchantId = '00000000-0000-4000-8000-000000000001';
  const trustedParams: TrustedOutboundParams = {
    merchantId,
    merchantSlug: 'ogabassey',
  };
  const products = generateOgabasseyBackingCatalog(
    options.productCount ?? 2000
  );
  const plane = new SimulatedPostgrestOutboundPlane({
    merchantId,
    products,
    generationSampleTtlMs: 15_000,
    originRpcLatencyMs: 0,
  });

  const schedule = buildRealisticStorefrontTrafficPool(products);
  // 1,800 requests across 180 seconds (3 minutes = 10 req/sec).
  const totalTicks = schedule.length;
  const tickDeltaMs = 100;
  const totalWritesInWindow = options.inventoryWritesPerMinute * 3;
  const writesPerTick = new Map<number, number>();
  for (let w = 0; w < totalWritesInWindow; w++) {
    const writeTick = Math.floor((w * totalTicks) / totalWritesInWindow);
    writesPerTick.set(writeTick, (writesPerTick.get(writeTick) ?? 0) + 1);
  }

  let writeCount = 0;
  for (let tick = 0; tick < totalTicks; tick++) {
    const writesAtTick = writesPerTick.get(tick) ?? 0;
    for (let w = 0; w < writesAtTick; w++) {
      plane.recordInventoryWrite(merchantId, tick + w);
      writeCount += 1;
    }
    const targetUrl = schedule[tick] ?? schedule[0];
    await plane.handleOutboundFetch(
      new Request(targetUrl),
      trustedParams,
      options.strategy
    );
    plane.advanceClockMs(tickDeltaMs);
  }

  const hitRatio =
    plane.telemetry.totalRequests > 0
      ? Number(
          (
            (plane.telemetry.cacheHits / plane.telemetry.totalRequests) *
            100
          ).toFixed(2)
        )
      : 0;

  return {
    inventoryWritesPerMinute: options.inventoryWritesPerMinute,
    strategy: options.strategy,
    totalRequests: plane.telemetry.totalRequests,
    writeCount,
    catalogCacheHitRatio: hitRatio,
    originGenerationReads: plane.telemetry.originGenerationReads,
    originCatalogRpcCalls: plane.telemetry.originCatalogRpcCalls,
    originAvailabilityRpcCalls: plane.telemetry.originAvailabilityRpcCalls,
  };
}
