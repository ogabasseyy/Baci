import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from '@/env';
import type { Database } from '@/types/supabase';

const serviceRoleClientBrand: unique symbol = Symbol(
  'baci.event-pipeline.service-role-client'
);
const adsCredentialsClientBrand: unique symbol = Symbol(
  'baci.ads-credentials.service-role-client'
);
const walletFundingRecoveryClientBrand: unique symbol = Symbol(
  'baci.wallet-funding-recovery.service-role-client'
);
const shippingQuoteBookingEconomicsClientBrand: unique symbol = Symbol(
  'baci.shipping-quote-booking-economics.service-role-client'
);
const serviceRoleBrandValue: true = true;

export type ServiceRoleClient = SupabaseClient<Database> & {
  readonly [serviceRoleClientBrand]: true;
};

/**
 * A service-role client reserved for the authenticated Ads credential paths.
 *
 * Keep this type distinct from `ServiceRoleClient` so an Ads credential client
 * cannot accidentally be passed to the event-pipeline helpers. The branded
 * factory is server-only by contract; callers must still enforce user,
 * merchant, and `integrations:manage` checks before using it.
 */
export type AdsCredentialServiceClient = SupabaseClient<Database> & {
  readonly [adsCredentialsClientBrand]: true;
};

/**
 * A service-role client reserved for wallet funding-recovery HMAC provisioning.
 *
 * Keep this type distinct from `ServiceRoleClient` so the cron helper cannot be
 * passed into event-pipeline helpers. Callers must authenticate with
 * `CRON_SECRET` before constructing it.
 */
export type WalletFundingRecoveryServiceClient = SupabaseClient<Database> & {
  readonly [walletFundingRecoveryClientBrand]: true;
};

/**
 * A service-role client reserved for shipping-quote booking economics reads.
 *
 * Keep this type distinct from `ServiceRoleClient` so booking helpers cannot be
 * passed into event-pipeline helpers. Callers must already authenticate the
 * merchant before constructing it.
 */
export type ShippingQuoteBookingEconomicsServiceClient =
  SupabaseClient<Database> & {
    readonly [shippingQuoteBookingEconomicsClientBrand]: true;
  };

/**
 * Creates a Supabase client with service role key for admin operations.
 * This client bypasses RLS policies and should only be used in:
 * - Webhook handlers (no user context)
 * - Background jobs
 * - Admin operations that require RLS bypass
 *
 * WARNING: Never expose this client to the frontend!
 */
export function createServiceClient(
  sentinel: 'event-pipeline'
): ServiceRoleClient;
export function createServiceClient(
  sentinel: 'ads-credentials'
): AdsCredentialServiceClient;
export function createServiceClient(
  sentinel: 'wallet-funding-recovery'
): WalletFundingRecoveryServiceClient;
export function createServiceClient(
  sentinel: 'shipping-quote-booking-economics'
): ShippingQuoteBookingEconomicsServiceClient;
export function createServiceClient(): SupabaseClient;
export function createServiceClient(
  sentinel?:
    | 'event-pipeline'
    | 'ads-credentials'
    | 'wallet-funding-recovery'
    | 'shipping-quote-booking-economics'
) {
  const url = getSupabaseUrl();
  // `SUPABASE_ADS_CREDENTIAL_KEY` is the preferred deployment secret for the
  // narrow Ads credential boundary. Keep the existing service-role key as a
  // compatibility fallback while deployments migrate; neither value is ever
  // returned to a caller or exposed to a client bundle.
  const serviceRoleKey =
    sentinel === 'ads-credentials'
      ? process.env.SUPABASE_ADS_CREDENTIAL_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY
      : process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'Supabase URL is missing. Please check your environment variables.'
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      sentinel === 'ads-credentials'
        ? 'SUPABASE_ADS_CREDENTIAL_KEY or SUPABASE_SERVICE_ROLE_KEY is missing. This is required for Ads credential handlers.'
        : 'SUPABASE_SERVICE_ROLE_KEY is missing. This is required for webhook handlers.'
    );
  }

  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: { fetch: globalThis.fetch },
  };
  if (sentinel === 'event-pipeline') {
    return Object.assign(createClient<Database>(url, serviceRoleKey, options), {
      [serviceRoleClientBrand]: serviceRoleBrandValue,
    });
  }
  if (sentinel === 'ads-credentials') {
    return Object.assign(createClient<Database>(url, serviceRoleKey, options), {
      [adsCredentialsClientBrand]: serviceRoleBrandValue,
    });
  }
  if (sentinel === 'wallet-funding-recovery') {
    return Object.assign(createClient<Database>(url, serviceRoleKey, options), {
      [walletFundingRecoveryClientBrand]: serviceRoleBrandValue,
    });
  }
  if (sentinel === 'shipping-quote-booking-economics') {
    return Object.assign(createClient<Database>(url, serviceRoleKey, options), {
      [shippingQuoteBookingEconomicsClientBrand]: serviceRoleBrandValue,
    });
  }
  return createClient(url, serviceRoleKey, options);
}
