import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { JumiaClient } from '@/lib/jumia/client';
import { resolveJumiaMarketplaceCurrency } from '@/lib/jumia/jumia-marketplace-currency';
import {
  loadProductPreflightMetadata,
  loadProductPreflightPage,
} from '@/lib/jumia/load-product-preflight';
import { prepareJumiaProductFeed } from '@/lib/jumia/prepare-product-feed';
import { packJumiaProductFamilies } from '@/lib/jumia/prepare-product-feed-families';
import { computeJumiaProductPreflightDigest } from '@/lib/jumia/product-preflight-digest';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import {
  jumiaProductPreflightRequestSchema,
  jumiaProductPreflightResponseSchema,
} from '@/schemas/jumia/product-preflight';
import { jumiaCanonicalProductProjectionSchema } from '@/schemas/jumia/product-preflight-source';
import { preflightRouteError as safeError } from './route-response';

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return safeError('Unauthorized', 401);

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return csrf.response ?? safeError('CSRF validation failed', 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError('Invalid JSON body', 400);
  }
  const parsed = jumiaProductPreflightRequestSchema.safeParse(body);
  if (!parsed.success) return safeError('Invalid preflight input', 400);
  const input = parsed.data;

  const merchantContext = await getMerchantForApiRequest(
    auth.supabase,
    auth.user.id,
    { requestedMerchantId: input.merchantId }
  );
  if (!merchantContext) return safeError('Merchant not found', 404);
  if (merchantContext.merchantId !== input.merchantId)
    return safeError('Forbidden', 403);
  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'integrations', 'manage'))
    return safeError('Forbidden', 403);
  const featureGateResponse = await requireMerchantFeatureAccess(
    auth.supabase,
    merchantContext.merchantId,
    'marketplace_sync'
  );
  if (featureGateResponse) return featureGateResponse;

  // The page coordinate is an untrusted locator. Read one authorized snapshot
  // page, then keep using that projection/version pair throughout preflight.
  const loaded = await loadProductPreflightPage(auth.supabase, {
    merchantId: merchantContext.merchantId,
    selectionId: input.selectionId,
    sourceCategoryId: input.sourceCategoryId,
    sourcePage: input.sourcePage,
    products: input.products,
  });
  if (!loaded.success)
    return safeError(
      'Selected products are unavailable or stale on this page',
      409
    );

  const parsedProjections = loaded.products.map((product) => ({
    ...product,
    parsed: jumiaCanonicalProductProjectionSchema.safeParse(product.projection),
  }));
  if (
    parsedProjections.some(
      ({ productId, parsed: projection }) =>
        !projection.success ||
        projection.data.product.id !== productId ||
        projection.data.product.merchantId !== merchantContext.merchantId ||
        !projection.data.categoryMemberships.some(
          (membership) =>
            membership.id === input.sourceCategoryId && membership.isActive
        )
    )
  )
    return safeError('Canonical product projection is inconsistent', 409);
  const projectionByProductId = new Map(
    parsedProjections.flatMap(({ productId, parsed: projection }) =>
      projection.success ? [[productId, projection.data] as const] : []
    )
  );

  let jumia: JumiaClient;
  try {
    // Exact integration lookup is constrained by merchant, platform and active state.
    jumia = await JumiaClient.forIntegration(
      auth.supabase,
      merchantContext.merchantId,
      input.integrationId
    );
  } catch {
    return safeError('Active Jumia integration not found', 404);
  }
  if (
    jumia.integrationId !== input.integrationId ||
    jumia.merchantId !== merchantContext.merchantId ||
    jumia.shopId === 'oauth' ||
    jumia.countryCode?.trim().toUpperCase() !== 'NG'
  )
    return safeError('An exact active Nigeria Jumia shop is required', 409);

  let shopMatches: Awaited<ReturnType<JumiaClient['getShops']>>;
  try {
    const shops = await jumia.getShops();
    shopMatches = shops.filter((shop) => shop.id === jumia.shopId);
  } catch {
    return safeError('Jumia destination metadata unavailable', 502);
  }
  if (shopMatches.length !== 1)
    return safeError('Connected Jumia shop could not be verified', 409);
  const matchingClients = shopMatches[0].businessClients.filter(
    (client) =>
      client.code === input.businessClientCode &&
      client.status === 'active' &&
      client.countryCode === 'NG'
  );
  if (matchingClients.length !== 1)
    return safeError('Selected Nigeria business client is unavailable', 409);
  const destinationCurrency = resolveJumiaMarketplaceCurrency(
    matchingClients[0].countryCode
  );
  if (!destinationCurrency.ok || destinationCurrency.currency !== 'NGN')
    return safeError('Selected Jumia destination currency is unsupported', 409);

  const currentMetadata = await loadProductPreflightMetadata(
    jumia,
    input.mappings
  );
  if (!currentMetadata.success)
    return safeError(
      currentMetadata.code === 'metadata_unavailable'
        ? 'Jumia preflight metadata unavailable'
        : 'Selected Jumia mapping metadata is unavailable',
      currentMetadata.code === 'metadata_unavailable' ? 502 : 409
    );
  const metadataByProductId = new Map(
    currentMetadata.mappings.map((item) => [item.productId, item])
  );
  const mappingByProductId = new Map(
    input.mappings.map((mapping) => [mapping.productId, mapping])
  );
  const verifiedMetadata = input.products.flatMap((selectedProduct) => {
    const mapping = mappingByProductId.get(selectedProduct.productId);
    const current = metadataByProductId.get(selectedProduct.productId);
    const projection = projectionByProductId.get(selectedProduct.productId);
    return mapping && current && projection
      ? [
          {
            mapping,
            sourceVersion: selectedProduct.sourceVersion,
            projection,
            category: current.category,
            brand: current.brand,
            attributes: current.attributes,
          },
        ]
      : [];
  });
  if (verifiedMetadata.length !== input.products.length)
    return safeError('Selected Jumia mapping metadata is unavailable', 409);

  const productResults = verifiedMetadata.map((entry) => {
    const source = entry.projection;
    const prepared = prepareJumiaProductFeed({
      merchantId: merchantContext.merchantId,
      selectionId: input.selectionId,
      sourceCategoryId: input.sourceCategoryId,
      sourceVersion: entry.sourceVersion,
      source,
      destination: {
        shopId: jumia.shopId,
        businessClientCode: input.businessClientCode,
        countryCode: 'NG',
        localCurrency: destinationCurrency.currency,
      },
      mapping: {
        category: {
          code: entry.category.code,
          name: entry.category.name,
          attributeSetId: entry.category.attributeSet.sid,
          activeLeaf: !entry.category.hasChildren,
          // Current provider catalog is provider-wide, not destination-specific.
          availableForDestination: false,
        },
        brand: {
          code: entry.brand.code,
          name: entry.brand.name,
          // No destination-specific brand evidence exists in this endpoint.
          availableForDestination: false,
        },
        attributes: entry.attributes,
        values: entry.mapping.attributes,
        categoryConfirmed: entry.mapping.categoryConfirmed,
        bullets: entry.mapping.bullets,
        variation: entry.mapping.variation,
      },
      evidence: {
        providerClassification: 'unknown',
        globalPrice: null,
        // No network image probe or caller-provided evidence is trusted here.
        images: {},
      },
    });
    return { entry, prepared };
  });

  const packed = productResults.flatMap(({ prepared }) =>
    prepared.success
      ? prepared.families.flatMap((family) =>
          family.records.map((record) => ({
            familyKey: family.familyKey,
            businessClientCode: family.businessClientCode,
            categoryCode: family.categoryCode,
            attributeSetId: family.attributeSetId,
            record,
          }))
        )
      : []
  );
  const packing = packJumiaProductFamilies(packed);
  const preparedScope = productResults.map(({ entry, prepared }) => ({
    productId: entry.mapping.productId,
    sourceVersion: entry.sourceVersion,
    mapping: entry.mapping,
    source: entry.projection,
    metadata: {
      category: entry.category,
      brand: entry.brand,
      attributes: entry.attributes,
    },
    evidence: {
      providerClassification: 'unknown',
      globalPrice: null,
      images: {},
      categoryAvailability: 'unproven',
      brandAvailability: 'unproven',
    },
    prepared,
  }));
  let digest: string;
  try {
    digest = computeJumiaProductPreflightDigest({
      merchantId: merchantContext.merchantId,
      integrationId: jumia.integrationId,
      shopId: jumia.shopId,
      businessClientCode: input.businessClientCode,
      countryCode: 'NG',
      localCurrency: destinationCurrency.currency,
      selectionId: input.selectionId,
      sourceCategoryId: input.sourceCategoryId,
      sourcePage: input.sourcePage,
      products: preparedScope,
    });
  } catch {
    return safeError('Unable to build safe preflight response', 500);
  }
  const response = jumiaProductPreflightResponseSchema.safeParse({
    scope: {
      selectionId: input.selectionId,
      sourceCategoryId: input.sourceCategoryId,
      sourcePage: input.sourcePage,
      productIds: input.products.map((product) => product.productId),
    },
    digest,
    products: productResults.map(({ entry, prepared }) => ({
      productId: entry.mapping.productId,
      sourceVersion: entry.sourceVersion,
      locallyValid: prepared.success,
      blockers: prepared.success
        ? packing.success
          ? []
          : packing.errors.map((error) => error.code)
        : prepared.errors.map((error) => `${error.field}:${error.code}`),
      recordCount: prepared.success ? prepared.products.length : 0,
    })),
    canSubmit: false,
  });
  if (!response.success)
    return safeError('Unable to build safe preflight response', 500);
  return NextResponse.json(response.data);
}
