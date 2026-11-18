import 'server-only';
import {
  type OxygenMobileCapabilities,
  oxygenMobileCapabilitiesSchema,
} from '@baci/shared/oxygen';
import {
  oxygenMobileCapabilitiesQuerySchema,
  oxygenMobileReadinessRowSchema,
} from '@/schemas/oxygen-mobile-capabilities';
import { resolveOxygenEnvironment } from './environment';
import { readOxygenHostedOrigins } from './oxygen-hosted-origins';
import { readOxygenRuntimeConfiguration } from './runtime-configuration';
import type { OxygenRuntimeRpc } from './runtime-service';

type CapabilityResult =
  | { ok: true; capabilities: OxygenMobileCapabilities }
  | { ok: false; status: 400 | 404 | 503 };

/** Validate before projecting an origin; arbitrary base paths never become valid pins. */
function readAuthPins(environment: 'staging' | 'production') {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash) return null;
    const secureRoot = url.protocol === 'https:' && base === url.origin;
    const localQa =
      environment === 'staging' &&
      ['development', 'test'].includes(process.env.NODE_ENV ?? '') &&
      process.env.VERCEL_ENV !== 'production' &&
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      base === `${url.origin}/qa-backend`;
    return secureRoot || localQa
      ? { authOrigin: url.origin, authBaseUrl: base }
      : null;
  } catch {
    return null;
  }
}

/** Read-only admission metadata. Never authorizes or disables owned workflow recovery. */
export async function readOxygenMobileCapabilities(
  client: OxygenRuntimeRpc,
  merchantSlug: string
): Promise<CapabilityResult> {
  if (!oxygenMobileCapabilitiesQuerySchema.safeParse({ merchantSlug }).success)
    return { ok: false, status: 400 };
  try {
    const { data, error } = await client.rpc(
      'oxygen_mobile_staging_readiness',
      {
        p_merchant_slug: merchantSlug,
      }
    );
    if (error || !Array.isArray(data)) return { ok: false, status: 503 };
    if (!data.length) return { ok: false, status: 404 };
    if (data.length !== 1) return { ok: false, status: 503 };
    const row = oxygenMobileReadinessRowSchema.safeParse(data[0]);
    const environment = resolveOxygenEnvironment();
    if (!row.success || row.data.merchant_slug !== merchantSlug || !environment)
      return { ok: false, status: 503 };
    const authPins = readAuthPins(environment);
    if (!authPins) return { ok: false, status: 503 };
    const origins = readOxygenHostedOrigins();
    const runtime = readOxygenRuntimeConfiguration();
    const reason =
      environment !== 'staging'
        ? 'Mobile staging is unavailable in production.'
        : process.env.OXYGEN_STAGING_MOBILE_ENABLED !== 'true'
          ? 'New mobile applications are disabled.'
          : !runtime ||
              runtime.environment !== environment ||
              row.data.environment !== environment ||
              !row.data.binding_ready
            ? 'This storefront is not configured for mobile staging.'
            : !origins.hosted.length || !origins.selfie.length
              ? 'Hosted verification is not configured.'
              : null;
    const parsed = oxygenMobileCapabilitiesSchema.safeParse({
      schemaVersion: 1,
      environment,
      ...authPins,
      merchant: { id: row.data.merchant_id, slug: row.data.merchant_slug },
      mobileEnabled: reason === null,
      reason,
      hostedOrigins: origins.hosted,
      selfieOrigins: origins.selfie,
    });
    return parsed.success
      ? { ok: true, capabilities: parsed.data }
      : { ok: false, status: 503 };
  } catch {
    return { ok: false, status: 503 };
  }
}
