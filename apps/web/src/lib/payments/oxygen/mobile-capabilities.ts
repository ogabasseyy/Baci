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
    // start_workflow takes the environment from the enabled merchant binding
    // (20261106150000_oxygen_production_pilot_guard.sql). Runtime execution
    // requires the same binding environment as the persisted workflow.
    const rolloutEnabled =
      environment === 'staging'
        ? process.env.OXYGEN_STAGING_MOBILE_ENABLED === 'true'
        : merchantSlug === 'ogabassey' &&
          process.env.OXYGEN_PRODUCTION_MOBILE_ENABLED === 'true' &&
          process.env.OXYGEN_PRODUCTION_AUTOMATIC_ACTIVATION_ENABLED === 'true';
    let reason = !rolloutEnabled
      ? 'New mobile applications are disabled.'
      : !runtime ||
          runtime.environment !== environment ||
          row.data.environment !== environment ||
          !row.data.binding_ready
        ? 'This storefront is not configured for Oxygen checkout.'
        : !origins.hosted.length || !origins.selfie.length
          ? 'Hosted verification is not configured.'
          : null;
    // Mobile staging admission requires `oxygen_enabled === true`. The local-only
    // web checkout staging flag (`payment-step-availability.ts`) is wired in the
    // follow-up checkout PR; `public.oxygen_start_workflow` still fails closed (42501).
    if (reason === null && environment === 'staging') {
      const featureSettings = await client.rpc(
        'get_storefront_payment_settings',
        { p_merchant_id: row.data.merchant_id }
      );
      if (featureSettings.error || !Array.isArray(featureSettings.data)) {
        return { ok: false, status: 503 };
      }
      const settingsRow = featureSettings.data[0] as
        | { oxygen_enabled?: unknown }
        | undefined;
      if (settingsRow?.oxygen_enabled !== true) {
        reason = 'Oxygen is disabled for this storefront.';
      }
    }
    if (reason === null && environment === 'production') {
      const admission = await client.rpc('oxygen_storefront_pilot_available', {
        p_merchant_id: row.data.merchant_id,
      });
      if (admission.error) return { ok: false, status: 503 };
      if (admission.data !== true)
        reason = 'Oxygen is unavailable for this customer.';
    }
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
