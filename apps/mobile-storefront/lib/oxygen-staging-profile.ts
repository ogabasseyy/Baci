import {
  type OxygenMobileCapabilities,
  oxygenMobileCapabilitiesSchema,
} from '@baci/shared/oxygen';
import type { OxygenStagingProfile } from '../config/oxygen-staging-profile';
import { readOxygenStagingProfile } from '../config/oxygen-staging-profile';

export type { OxygenStagingProfile };
export { readOxygenStagingProfile };

export type OxygenStagingOwner = {
  userId: string | null;
  customer: { user_id: string | null; merchant_id: string } | null;
};

export function oxygenStagingCapabilityPinsMatch(
  profile: Pick<
    OxygenStagingProfile,
    'authOrigin' | 'merchantId' | 'merchantSlug'
  > & {
    authBaseUrl?: string;
  },
  capabilities: OxygenMobileCapabilities
): boolean {
  return (
    capabilities.environment === 'staging' &&
    capabilities.authOrigin === profile.authOrigin &&
    (capabilities.authBaseUrl ?? capabilities.authOrigin) ===
      (profile.authBaseUrl ?? profile.authOrigin) &&
    capabilities.merchant.id === profile.merchantId &&
    capabilities.merchant.slug === profile.merchantSlug
  );
}

export function assertOxygenStagingCapabilities(
  profile: OxygenStagingProfile,
  input: unknown,
  owner: OxygenStagingOwner,
  newInitiation: boolean
) {
  if (
    !owner.userId ||
    !owner.customer ||
    owner.customer.user_id !== owner.userId ||
    owner.customer.merchant_id !== profile.merchantId
  )
    throw new Error(
      'Oxygen setup requires a linked staging customer. Sign in to the staging merchant.'
    );
  const capabilities = oxygenMobileCapabilitiesSchema.parse(input);
  if (!oxygenStagingCapabilityPinsMatch(profile, capabilities))
    throw new Error('Oxygen staging capability pins do not match this app');
  if (newInitiation && !capabilities.mobileEnabled)
    throw new Error(
      'New Oxygen applications are unavailable in this staging environment'
    );
  return capabilities;
}

type RuntimeGlobal = typeof globalThis & {
  __baciOxygenStagingRuntime?: { profile: OxygenStagingProfile };
};
export function getOxygenStagingProfile(): OxygenStagingProfile | null {
  return (
    (globalThis as RuntimeGlobal).__baciOxygenStagingRuntime?.profile ?? null
  );
}

export function oxygenStagingStorageKey(key: string): string {
  const prefix = getOxygenStagingProfile()?.storagePrefix;
  return prefix && !key.startsWith(prefix) ? `${prefix}${key}` : key;
}
