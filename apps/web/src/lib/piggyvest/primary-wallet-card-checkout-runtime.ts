import 'server-only';
import { primaryWalletCardCheckoutRuntimeSchema } from '@/schemas/primary-wallet-card-checkout-runtime';

export function readPrimaryWalletCardCheckoutRuntime(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
) {
  return parseRuntime(env, now, false);
}

// Drain/recovery reader for status polling and webhook reconciliation:
// after expiresAt no NEW checkout may start, but operations created
// before expiry must still resolve (status reads, collection recording)
// or customers stay charged-but-uncredited while Paystack retries a 503.
// Only the deadline is bypassed; every other gate still fails closed.
export function readPrimaryWalletCardCheckoutRuntimeDrain(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
) {
  return parseRuntime(env, now, true);
}

function parseRuntime(
  env: NodeJS.ProcessEnv,
  now: number,
  allowExpired: boolean
) {
  if (env.PIGGYVEST_PRIMARY_CARD_ENABLED !== 'true') return null;
  const environment = env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT;
  if ((env.VERCEL_ENV === 'production') !== (environment === 'production'))
    return null;
  const database = {
    host: env.PIGGYVEST_PRIMARY_CARD_DB_HOST,
    port: Number(env.PIGGYVEST_PRIMARY_CARD_DB_PORT),
    name: env.PIGGYVEST_PRIMARY_CARD_DB_NAME,
    certificateAuthority: env.PIGGYVEST_PRIMARY_CARD_DB_CA,
  };
  const parsed = primaryWalletCardCheckoutRuntimeSchema.safeParse({
    settings: {
      environment,
      integrationId: env.PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID,
      merchantId: env.PIGGYVEST_PRIMARY_CARD_MERCHANT_ID,
      businessId: env.PIGGYVEST_PRIMARY_CARD_BUSINESS_ID,
      expiresAt: env.PIGGYVEST_PRIMARY_CARD_EXPIRES_AT,
      callbackUrl: env.PIGGYVEST_PRIMARY_CARD_CALLBACK_URL,
      paystackSecret: env.PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET,
    },
    authorizer: {
      ...database,
      login: 'baci_primary_card_authorizer',
      password: env.PIGGYVEST_PRIMARY_CARD_AUTHORIZER_PASSWORD,
    },
    evidence: {
      ...database,
      login: 'baci_primary_card_evidence',
      password: env.PIGGYVEST_PRIMARY_CARD_EVIDENCE_PASSWORD,
    },
  });
  if (
    !parsed.success ||
    !Number.isFinite(now) ||
    (!allowExpired && now >= Date.parse(parsed.data.settings.expiresAt))
  )
    return null;
  return parsed.data;
}
