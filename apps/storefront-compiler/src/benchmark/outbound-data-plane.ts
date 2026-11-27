import { createHash } from 'node:crypto';
import {
  type CatalogSearchResponse,
  executeSimulatedAnonCatalogRpc,
} from './anon-catalog-rpc';
import type {
  BackingCatalogProduct,
  PublicProjectedProduct,
} from './ogabassey-catalog-fixture';
import { applyVariantStockOverlayToJson } from './outbound-overlay';

export type { CatalogSearchResponse };

const ALLOWED_SEARCH_QUERY_KEYS = [
  'brand',
  'category',
  'condition',
  'limit',
  'page',
  'q',
] as const;
const ALLOWED_PRODUCT_QUERY_KEYS = [
  'category',
  'productId',
  'productSlug',
] as const;

export type CacheKeyStrategy = 'single-generation' | 'split-availability';

export interface TrustedOutboundParams {
  merchantId: string;
  merchantSlug: string;
}

export interface OutboundTelemetry {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  originGenerationReads: number;
  originCatalogRpcCalls: number;
  originAvailabilityRpcCalls: number;
  spoofedTenantIgnoredCount: number;
}

/** Simulates WfP Outbound Worker tenant binding + split-availability edge cache. */
export class SimulatedPostgrestOutboundPlane {
  private readonly catalogByMerchant = new Map<
    string,
    BackingCatalogProduct[]
  >();
  private readonly structureGen = new Map<string, number>();
  private readonly availabilityGen = new Map<string, number>();
  private readonly coupledGen = new Map<string, number>();

  private readonly edgeCache = new Map<
    string,
    { body: string; expiresAtMs: number }
  >();
  private readonly sampledGenCache = new Map<
    string,
    {
      coupled: number;
      structure: number;
      availability: number;
      expiresAtMs: number;
    }
  >();

  private nowMs = 1_700_000_000_000;
  private readonly generationSampleTtlMs: number;
  private readonly originRpcLatencyMs: number;

  public readonly telemetry: OutboundTelemetry = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    originGenerationReads: 0,
    originCatalogRpcCalls: 0,
    originAvailabilityRpcCalls: 0,
    spoofedTenantIgnoredCount: 0,
  };

  constructor(options: {
    merchantId: string;
    products: BackingCatalogProduct[];
    generationSampleTtlMs?: number;
    originRpcLatencyMs?: number;
  }) {
    this.catalogByMerchant.set(options.merchantId, options.products);
    this.structureGen.set(options.merchantId, 1);
    this.availabilityGen.set(options.merchantId, 1);
    this.coupledGen.set(options.merchantId, 1);
    this.generationSampleTtlMs = options.generationSampleTtlMs ?? 15_000;
    this.originRpcLatencyMs = options.originRpcLatencyMs ?? 0;
  }

  public advanceClockMs(deltaMs: number): void {
    this.nowMs += deltaMs;
  }

  public recordInventoryWrite(
    merchantId: string,
    variantIndex: number,
    explicitQty?: number
  ): void {
    const catalog = this.catalogByMerchant.get(merchantId);
    if (!catalog || catalog.length === 0) return;
    const product = catalog[variantIndex % catalog.length];
    if (!product) return;
    if (explicitQty !== undefined) {
      for (const variant of product.variants) {
        variant.stockQty = explicitQty;
      }
    } else if (product.variants[0]) {
      product.variants[0].stockQty =
        product.variants[0].stockQty > 0 ? product.variants[0].stockQty - 1 : 8;
    }
    this.coupledGen.set(merchantId, (this.coupledGen.get(merchantId) ?? 1) + 1);
    this.availabilityGen.set(
      merchantId,
      (this.availabilityGen.get(merchantId) ?? 1) + 1
    );
  }

  public recordCatalogMetadataWrite(merchantId: string): void {
    this.coupledGen.set(merchantId, (this.coupledGen.get(merchantId) ?? 1) + 1);
    this.structureGen.set(
      merchantId,
      (this.structureGen.get(merchantId) ?? 1) + 1
    );
  }

  private async simulateOriginDelay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async resolveSampledGenerations(merchantId: string) {
    const cached = this.sampledGenCache.get(merchantId);
    if (cached && cached.expiresAtMs > this.nowMs) {
      return cached;
    }
    this.telemetry.originGenerationReads += 1;
    await this.simulateOriginDelay(this.originRpcLatencyMs * 0.25);
    const entry = {
      coupled: this.coupledGen.get(merchantId) ?? 1,
      structure: this.structureGen.get(merchantId) ?? 1,
      availability: this.availabilityGen.get(merchantId) ?? 1,
      expiresAtMs: this.nowMs + this.generationSampleTtlMs,
    };
    this.sampledGenCache.set(merchantId, entry);
    return entry;
  }

  public async handleOutboundFetch(
    request: Request,
    trustedParams: TrustedOutboundParams,
    strategy: CacheKeyStrategy
  ): Promise<Response> {
    const url = new URL(request.url);
    const isApprovedCatalogEndpoint =
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.origin === 'https://catalog.baci.internal' &&
      (url.pathname === '/v1/search' || url.pathname === '/v1/product');
    if (!isApprovedCatalogEndpoint) {
      return new Response(
        JSON.stringify({ error: 'Egress endpoint or method denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      );
    }

    const untrustedMerchantHint =
      url.searchParams.get('merchantId') ??
      url.searchParams.get('slug') ??
      request.headers.get('x-merchant-id');
    if (
      untrustedMerchantHint &&
      untrustedMerchantHint !== trustedParams.merchantId &&
      untrustedMerchantHint !== trustedParams.merchantSlug
    ) {
      this.telemetry.spoofedTenantIgnoredCount += 1;
    }
    url.searchParams.delete('merchantId');
    url.searchParams.delete('slug');

    const allowedKeys =
      url.pathname === '/v1/product'
        ? ALLOWED_PRODUCT_QUERY_KEYS
        : ALLOWED_SEARCH_QUERY_KEYS;
    const canonicalParams = new URLSearchParams();
    for (const key of allowedKeys) {
      const value = url.searchParams.get(key);
      if (value !== null && value !== '') {
        canonicalParams.set(key, value);
      }
    }
    url.search = canonicalParams.toString();

    this.telemetry.totalRequests += 1;
    const merchantId = trustedParams.merchantId;
    const generations = await this.resolveSampledGenerations(merchantId);

    const queryHash = createHash('sha256')
      .update(`${url.pathname}?${url.searchParams.toString()}`)
      .digest('hex')
      .slice(0, 24);

    const activeGen =
      strategy === 'single-generation'
        ? generations.coupled
        : generations.structure;
    const cacheKey = `https://cache.baci.internal/v1/${merchantId}/g/${activeGen}/${queryHash}`;

    const hit = this.edgeCache.get(cacheKey);
    const isFreshHit = hit !== undefined && hit.expiresAtMs > this.nowMs;
    let baseJson: string;
    if (isFreshHit) {
      this.telemetry.cacheHits += 1;
      baseJson = hit.body;
    } else {
      this.telemetry.cacheMisses += 1;
      this.telemetry.originCatalogRpcCalls += 1;
      await this.simulateOriginDelay(this.originRpcLatencyMs);
      const rows = this.catalogByMerchant.get(merchantId) ?? [];
      baseJson = executeSimulatedAnonCatalogRpc(
        url,
        merchantId,
        rows,
        generations
      );
      this.edgeCache.set(cacheKey, {
        body: baseJson,
        expiresAtMs: this.nowMs + 86_400_000,
      });
    }

    let responseJson = baseJson;
    if (strategy === 'split-availability') {
      const availKey = `https://cache.baci.internal/v1/${merchantId}/avail/${generations.availability}/${queryHash}`;
      const availHit = this.edgeCache.get(availKey);
      let availJson: string;
      if (availHit && availHit.expiresAtMs > this.nowMs) {
        availJson = availHit.body;
      } else {
        this.telemetry.originAvailabilityRpcCalls += 1;
        await this.simulateOriginDelay(this.originRpcLatencyMs * 0.2);
        const variantMap = this.computeVariantStockOverlay(
          merchantId,
          baseJson
        );
        availJson = JSON.stringify(variantMap);
        this.edgeCache.set(availKey, {
          body: availJson,
          expiresAtMs: this.nowMs + 86_400_000,
        });
      }
      const parsedOverlay = JSON.parse(availJson) as Record<string, boolean>;
      responseJson = applyVariantStockOverlayToJson(baseJson, parsedOverlay, {
        coupled: generations.coupled,
        availability: generations.availability,
      });
    }

    return new Response(responseJson, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-baci-cache': isFreshHit ? 'HIT' : 'MISS',
        'x-baci-tenant': merchantId,
      },
    });
  }

  private computeVariantStockOverlay(
    merchantId: string,
    cachedBody: string
  ): Record<string, boolean> {
    const parsed = JSON.parse(cachedBody) as {
      products?: PublicProjectedProduct[];
      product?: PublicProjectedProduct | null;
    };
    const rows = this.catalogByMerchant.get(merchantId) ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const variantOverlay: Record<string, boolean> = {};
    const targets = parsed.products ?? (parsed.product ? [parsed.product] : []);
    for (const item of targets) {
      const backing = byId.get(item.id);
      if (!backing) continue;
      for (const variant of backing.variants) {
        variantOverlay[variant.id] = variant.stockQty > 0;
      }
    }
    return variantOverlay;
  }
}
