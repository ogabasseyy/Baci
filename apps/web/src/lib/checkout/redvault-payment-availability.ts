import { getRedvaultLivePilotPolicy } from './redvault-live-pilot';

export type RedvaultPaymentAvailability = {
  available: boolean;
  reason:
    | 'provider_evidence_unavailable'
    | 'staging_test_mode'
    | 'private_live_pilot';
};

const LIVE_BACI_SUPABASE_HOST = 'aivqthbxdshhltbwipbr.supabase.co';

function isPreviewOrLocalTest(appUrl: URL): boolean {
  if (process.env.VERCEL_ENV === 'preview') {
    return appUrl.protocol === 'https:';
  }

  return (
    !process.env.VERCEL_ENV &&
    process.env.NODE_ENV === 'development' &&
    ['localhost', '127.0.0.1'].includes(appUrl.hostname)
  );
}

function hasIsolatedStagingPaymentConfiguration(): boolean {
  const configuredUrl = process.env.REDVAULT_STAGING_SUPABASE_URL;
  const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl || !appUrl || configuredUrl !== appUrl) {
    return false;
  }

  try {
    const parsed = new URL(appUrl);
    if (
      parsed.hostname === LIVE_BACI_SUPABASE_HOST ||
      !isPreviewOrLocalTest(parsed)
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_') === true;
}

export function getRedvaultPaymentAvailability(): RedvaultPaymentAvailability {
  if (getRedvaultLivePilotPolicy()) {
    return { available: true, reason: 'private_live_pilot' };
  }
  if (
    process.env.BACI_RUNTIME_ENV === 'staging' &&
    process.env.REDVAULT_STAGING_TEST_ENABLED === 'true' &&
    hasIsolatedStagingPaymentConfiguration()
  ) {
    return { available: true, reason: 'staging_test_mode' };
  }

  return { available: false, reason: 'provider_evidence_unavailable' };
}
