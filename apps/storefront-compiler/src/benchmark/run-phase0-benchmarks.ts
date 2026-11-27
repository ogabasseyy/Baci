import { performance } from 'node:perf_hooks';
import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import {
  type CompiledStorefrontRelease,
  compileStorefrontWorker,
} from '../compiler/compile-storefront';
import { deriveCompileSigkillTimeoutMs } from '../sandbox/container-profiles';
import { measureColdCliProcessSamples } from './cold-cli-probe';
import {
  type ChurnScenarioMetrics,
  runGenerationChurnBenchmarkAsync,
} from './generation-churn-sim';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from './ogabassey-catalog-fixture';
import {
  SimulatedPostgrestOutboundPlane,
  type TrustedOutboundParams,
} from './outbound-data-plane';

export { type ChurnScenarioMetrics, runGenerationChurnBenchmarkAsync };

export interface RouteBenchmarkMetrics {
  route: string;
  expectedStatus: number;
  coldWallMs: number;
  warmP50WallMs: number;
  warmP95WallMs: number;
  warmP50IsolateSsrMs: number;
  warmP95IsolateSsrMs: number;
  htmlBytes: number;
}

export interface Phase0BenchmarkReport {
  catalogProductCount: number;
  compiler: {
    coldCompileMs: number;
    coldProcessP95CompileMs: number;
    warmP50CompileMs: number;
    warmP95CompileMs: number;
    derivedSigkillTimeoutMs: number;
    workerRawBytes: number;
    workerGzipBytes: number;
    clientRawBytes: number;
    clientGzipBytes: number;
    cssRawBytes: number;
    cssGzipBytes: number;
  };
  workerdSsr: {
    routes: RouteBenchmarkMetrics[];
    true404Verified: boolean;
    anonCostPriceContained: boolean;
    spoofedTenantBlocked: boolean;
  };
  generationChurn: ChurnScenarioMetrics[];
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return Number((sorted[idx] ?? 0).toFixed(2));
}

function parseServerTimingSsrMs(headerValue: string | null): number {
  if (!headerValue) return 0;
  const match = /ssr;dur=([0-9.]+)/.exec(headerValue);
  return match?.[1] ? Number.parseFloat(match[1]) : 0;
}

export async function runPhase0Benchmarks(options?: {
  warmCompileIterations?: number;
  coldCliProcessIterations?: number;
  warmSsrIterations?: number;
  productCount?: number;
}): Promise<Phase0BenchmarkReport> {
  const warmCompileIterations = options?.warmCompileIterations ?? 15;
  const coldCliProcessIterations = options?.coldCliProcessIterations ?? 3;
  const warmSsrIterations = options?.warmSsrIterations ?? 20;
  const productCount = options?.productCount ?? 2000;

  const manifest = createOgabasseyStorefrontManifest();
  const manifestJson = JSON.stringify(manifest);

  const coldCompileStart = performance.now();
  const initialRelease: CompiledStorefrontRelease =
    await compileStorefrontWorker(manifest);
  const coldCompileMs = Number(
    (performance.now() - coldCompileStart).toFixed(2)
  );
  const coldProcessSamples = await measureColdCliProcessSamples(
    manifestJson,
    coldCliProcessIterations
  );
  const coldProcessP95CompileMs = percentile(coldProcessSamples, 95);

  const warmCompileSamples: number[] = [];
  for (let i = 0; i < warmCompileIterations; i++) {
    const start = performance.now();
    await compileStorefrontWorker(manifest);
    warmCompileSamples.push(performance.now() - start);
  }
  const warmP50CompileMs = percentile(warmCompileSamples, 50);
  const warmP95CompileMs = percentile(warmCompileSamples, 95);
  const derivedSigkillTimeoutMs = deriveCompileSigkillTimeoutMs(
    Math.max(coldCompileMs, coldProcessP95CompileMs, warmP95CompileMs)
  );

  const merchantId = '00000000-0000-4000-8000-000000000001';
  const trustedParams: TrustedOutboundParams = {
    merchantId,
    merchantSlug: 'ogabassey',
  };
  const products = generateOgabasseyBackingCatalog(productCount);
  const outboundPlane = new SimulatedPostgrestOutboundPlane({
    merchantId,
    products,
    generationSampleTtlMs: 15_000,
    originRpcLatencyMs: 0,
  });

  const createBenchmarkIsolate = () =>
    new Miniflare({
      modules: [
        {
          type: 'ESModule',
          path: 'worker.mjs',
          contents: initialRelease.workerCode,
        },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: async (mfReq: MiniflareRequest) => {
        const copiedHeaders = new Headers();
        mfReq.headers.forEach((value, key) => {
          copiedHeaders.append(key, value);
        });
        const webReq = new Request(mfReq.url, {
          method: mfReq.method,
          headers: copiedHeaders,
        });
        const webRes = await outboundPlane.handleOutboundFetch(
          webReq,
          trustedParams,
          'split-availability'
        );
        const bodyText = await webRes.text();
        return new MiniflareResponse(bodyText, {
          status: webRes.status,
          headers: Object.fromEntries(webRes.headers.entries()),
        });
      },
    });

  const benchmarkRoutes: readonly {
    route: string;
    expectedStatus: number;
  }[] = [
    { route: '/', expectedStatus: 200 },
    { route: '/smartphones', expectedStatus: 200 },
    {
      route: '/search?q=iphone&brand=Apple&condition=New',
      expectedStatus: 200,
    },
    {
      route: '/smartphones/apple-iphone-16-pro-max-1',
      expectedStatus: 200,
    },
    { route: '/unknown-category-slug', expectedStatus: 404 },
  ];

  const routeMetrics: RouteBenchmarkMetrics[] = [];
  let true404Verified = true;
  let anonCostPriceContained = true;

  for (const item of benchmarkRoutes) {
    const mf = createBenchmarkIsolate();
    try {
      const fullUrl = `https://ogabassey.mybaci.store${item.route}`;
      const coldStart = performance.now();
      const coldRes = await mf.dispatchFetch(fullUrl);
      const coldHtml = await coldRes.text();
      const coldWallMs = Number((performance.now() - coldStart).toFixed(2));

      if (coldRes.status !== item.expectedStatus) {
        true404Verified = false;
      }
      if (
        coldHtml.includes('costPriceNgn') ||
        coldHtml.includes('SUP-LAGOS-')
      ) {
        anonCostPriceContained = false;
      }

      const warmWalls: number[] = [];
      const warmIsolateSsrs: number[] = [];
      for (let i = 0; i < warmSsrIterations; i++) {
        const wStart = performance.now();
        const wRes = await mf.dispatchFetch(fullUrl);
        await wRes.text();
        warmWalls.push(performance.now() - wStart);
        warmIsolateSsrs.push(
          parseServerTimingSsrMs(wRes.headers.get('server-timing'))
        );
      }

      routeMetrics.push({
        route: item.route,
        expectedStatus: item.expectedStatus,
        coldWallMs,
        warmP50WallMs: percentile(warmWalls, 50),
        warmP95WallMs: percentile(warmWalls, 95),
        warmP50IsolateSsrMs: percentile(warmIsolateSsrs, 50),
        warmP95IsolateSsrMs: percentile(warmIsolateSsrs, 95),
        htmlBytes: Buffer.byteLength(coldHtml, 'utf8'),
      });
    } finally {
      await mf.dispose();
    }
  }

  const spoofIsolate = createBenchmarkIsolate();
  try {
    const spoofRes = await spoofIsolate.dispatchFetch(
      'https://ogabassey.mybaci.store/search?q=iphone&merchantId=victim-tenant',
      { headers: { 'x-baci-merchant-slug': 'victim-tenant' } }
    );
    const spoofHtml = await spoofRes.text();
    const directOutboundSpoofRes = await outboundPlane.handleOutboundFetch(
      new Request(
        'https://catalog.baci.internal/v1/search?category=smartphones&merchantId=99999999-9999-4999-8999-999999999999'
      ),
      trustedParams,
      'split-availability'
    );
    const spoofedTenantBlocked =
      spoofRes.status === 200 &&
      !spoofHtml.includes('victim-tenant') &&
      directOutboundSpoofRes.headers.get('x-baci-tenant') === merchantId &&
      outboundPlane.telemetry.spoofedTenantIgnoredCount >= 1;

    const writeRates = [0, 2, 12, 60] as const;
    const churnResults: ChurnScenarioMetrics[] = [];
    for (const rate of writeRates) {
      churnResults.push(
        await runGenerationChurnBenchmarkAsync({
          inventoryWritesPerMinute: rate,
          strategy: 'single-generation',
          productCount,
        })
      );
      churnResults.push(
        await runGenerationChurnBenchmarkAsync({
          inventoryWritesPerMinute: rate,
          strategy: 'split-availability',
          productCount,
        })
      );
    }

    return {
      catalogProductCount: productCount,
      compiler: {
        coldCompileMs,
        coldProcessP95CompileMs,
        warmP50CompileMs,
        warmP95CompileMs,
        derivedSigkillTimeoutMs,
        ...initialRelease.metrics,
      },
      workerdSsr: {
        routes: routeMetrics,
        true404Verified,
        anonCostPriceContained,
        spoofedTenantBlocked,
      },
      generationChurn: churnResults,
    };
  } finally {
    await spoofIsolate.dispose();
  }
}
