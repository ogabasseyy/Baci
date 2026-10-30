import {
  IMEI_IDENTIFIER_BY_DEVICE,
  IMEI_SERVICE_TIERS,
  type ImeiIdentifierType,
  isValidDeviceIdentifier,
  normalizeDeviceIdentifier,
  PUBLIC_IMEI_SERVICE_TIERS,
  resolveInputIdentifier,
} from '@baci/shared/imei';
import type { NextRequest } from 'next/server';
import {
  getImeiDisabledTierKeys,
  getImeiHashSalt,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getPetrockEnabledTierKeys,
  getRootDomain,
  getSickwApiKey,
  isPetrockEnabled,
} from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  createImeiAccessClient,
  type ImeiAccessClient,
} from '@/lib/imei-access';
import { resolveImeiCustomer } from '@/lib/imei-lookup-fulfillment';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { imeiCheckSchema } from '@/schemas/imei-check';
import { createImeiCapabilitiesHandler } from './capabilities-handler';
import { executeImeiLookup } from './execute-imei-lookup';
import { prepareImeiProvider } from './prepare-imei-provider';
import {
  errorBody,
  findLookupByIdempotencyKey,
  hashImei,
  json,
  mapExistingLookup,
  mapExistingTerminalLookupWithoutImeiHash,
  UUID_PATTERN,
} from './route-helpers';

const PUBLIC_IMEI_SERVICE_TIER_KEYS = new Set<string>(
  PUBLIC_IMEI_SERVICE_TIERS
);

const INVALID_IDENTIFIER_MESSAGE: Record<ImeiIdentifierType, string> = {
  imei: 'Invalid IMEI number',
  serial: 'Invalid serial number',
  both: 'Invalid IMEI or serial number',
};

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return json(
        errorBody({ code: 'AUTH_REQUIRED', error: 'Unauthorized' }),
        401
      );
    }
    const supabase = auth.supabase;

    const rateLimit = await checkRateLimit(request);
    if (!rateLimit.allowed) {
      return createRateLimitResponse(
        rateLimit.limit,
        rateLimit.remaining,
        rateLimit.resetTime
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        json(
          errorBody({ code: 'CSRF_INVALID', error: 'CSRF validation failed' }),
          403
        )
      );
    }

    const rawIdempotencyKey = request.headers.get('Idempotency-Key') ?? '';
    if (!rawIdempotencyKey || !UUID_PATTERN.test(rawIdempotencyKey)) {
      return json(
        errorBody({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          error: 'Missing or invalid Idempotency-Key header.',
        }),
        400
      );
    }
    const idempotencyKey = rawIdempotencyKey.toLowerCase();

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return json(
        errorBody({ code: 'INVALID_JSON', error: 'Invalid JSON' }),
        400
      );
    }

    const bodyParse = imeiCheckSchema.safeParse(rawBody);
    if (!bodyParse.success) {
      return json(
        errorBody({
          code: 'INVALID_REQUEST_BODY',
          error: 'Invalid request body',
        }),
        400
      );
    }
    const merchantResolution = await resolveStorefrontMerchantFromRequest({
      fallbackIdentifier: bodyParse.data.merchantSlug,
      lookupError: 'Failed to validate storefront host',
      notFoundError: 'IMEI check is only available on storefront hosts',
      request,
      rootDomain: getRootDomain() || 'usebaci.com',
    });
    if (!merchantResolution.success) {
      return json(
        errorBody({
          code: 'STOREFRONT_NOT_FOUND',
          error: merchantResolution.error,
        }),
        merchantResolution.status
      );
    }
    const merchantId = String(merchantResolution.merchant.id);
    const requestedTier = bodyParse.data.tier;
    const deviceCategory = bodyParse.data.device;
    const clientSupportsAsync =
      bodyParse.data.clientCapabilities.includes('imei-async-v1');
    if (!PUBLIC_IMEI_SERVICE_TIER_KEYS.has(requestedTier)) {
      return json(
        errorBody({
          code: 'IMEI_TIER_NOT_AVAILABLE',
          error: 'Selected IMEI service tier is not available.',
        }),
        400
      );
    }

    const tierIdentifier = IMEI_SERVICE_TIERS[requestedTier].identifier;
    const requestedIdentifier = deviceCategory
      ? resolveInputIdentifier(
          tierIdentifier,
          IMEI_IDENTIFIER_BY_DEVICE[deviceCategory]
        )
      : tierIdentifier;
    // Validate the RAW submitted value first. Normalizing before validating
    // would silently truncate an over-length input (e.g. a 15-char serial
    // sliced to 14) into a spurious "valid" value that then bills a wallet
    // debit + paid provider call. Reject first, THEN normalize.
    if (!isValidDeviceIdentifier(bodyParse.data.imei, requestedIdentifier)) {
      return json(
        errorBody({
          code: 'INVALID_IMEI',
          error: INVALID_IDENTIFIER_MESSAGE[requestedIdentifier],
        }),
        400
      );
    }
    // Canonicalize (uppercase serials, strip separators) so replay hashing and
    // the provider call key off the same value — a mixed-case serial otherwise
    // hashes differently on replay. A raw-valid identifier has no separators
    // and is already within length, so this only case-folds it.
    const normalizedImei = normalizeDeviceIdentifier(
      bodyParse.data.imei,
      requestedIdentifier
    );

    const customer = await resolveImeiCustomer({
      merchantId,
      supabase,
      user: auth.user,
    });
    if (!customer) {
      return json(
        errorBody({
          code: 'CUSTOMER_NOT_FOUND',
          error: 'Customer account not found for this storefront',
        }),
        404
      );
    }

    let supabaseAdmin: ImeiAccessClient;
    try {
      supabaseAdmin = createImeiAccessClient({
        customerId: customer.id,
        merchantId,
        supabase,
        userId: auth.user.id,
      });
    } catch {
      return json(
        errorBody({
          code: 'IMEI_ACCESS_UNAVAILABLE',
          error: 'IMEI lookup is temporarily unavailable',
        }),
        503
      );
    }

    const hashSalt = getImeiHashSalt();
    if (!hashSalt) {
      const existingLookup = await findLookupByIdempotencyKey(
        supabaseAdmin,
        idempotencyKey
      );
      if (existingLookup) {
        return mapExistingTerminalLookupWithoutImeiHash(existingLookup, {
          customerId: customer.id,
          merchantId,
          tier: requestedTier,
        });
      }

      console.error('[IMEI Check] IMEI_HASH_SALT is not configured');
      return json(
        errorBody({
          code: 'IMEI_HASH_SALT_MISSING',
          error: 'IMEI lookup is temporarily unavailable',
        }),
        503
      );
    }
    const imeiHash = hashImei(normalizedImei, hashSalt);

    const replayContext = {
      customerId: customer.id,
      deviceCategory,
      imeiHash,
      merchantId,
      tier: requestedTier,
    };
    const existingLookup = await findLookupByIdempotencyKey(
      supabaseAdmin,
      idempotencyKey
    );
    if (existingLookup) {
      return mapExistingLookup(existingLookup, replayContext);
    }

    const prepared = await prepareImeiProvider({
      access: supabaseAdmin,
      configuration: {
        getImeiDisabledTierKeys,
        getImeiIdentifierEncryptionKey,
        getPetrockConfig,
        getPetrockEnabledTierKeys,
        getSickwApiKey,
        isPetrockEnabled,
      },
      clientSupportsAsync,
      deviceCategory,
      requestedTier,
    });
    if (prepared.response) return prepared.response;
    return await executeImeiLookup({
      ...prepared,
      customer,
      deviceCategory,
      idempotencyKey,
      imeiHash,
      merchantId,
      normalizedImei,
      replayContext,
      request,
      requestedTier,
      supabase,
      supabaseAdmin,
    });
  } catch (error) {
    console.error('IMEI check error:', error);
    return json(
      errorBody({ code: 'INTERNAL_ERROR', error: 'Internal server error' }),
      500
    );
  }
}

export const GET = createImeiCapabilitiesHandler({
  getAccessSigningSecret: () => process.env.IMEI_ACCESS_SIGNING_SECRET,
  getImeiDisabledTierKeys,
  getImeiHashSalt,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getPetrockEnabledTierKeys,
  getSickwApiKey,
  isPetrockEnabled,
});
