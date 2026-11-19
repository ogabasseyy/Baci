import 'server-only';

import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
  PUBLIC_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';
import { resolveImeiProviderBinding } from '@/lib/imei-providers/tier-bindings';

/** Narrow getter injection keeps environment authority in the existing route. */
export interface ImeiCapabilitiesConfiguration {
  getAccessSigningSecret(): string | undefined;
  getImeiDisabledTierKeys(): readonly string[];
  getImeiHashSalt(): string | undefined;
  getImeiIdentifierEncryptionKey(): string | undefined;
  getPetrockConfig(): { baseUrl: string; token: string } | null;
  getPetrockEnabledTierKeys(): readonly string[];
  getSickwApiKey(): string | undefined;
  isPetrockEnabled(): boolean;
}

/** Configuration advertisement only. POST still verifies the current product
 * snapshot and payment boundary before charging; discovery does not promise
 * provider availability or database provisioning and performs no database I/O.
 */
type CapabilitiesInput = {
  configuration: ImeiCapabilitiesConfiguration;
  device?: ImeiDeviceCategory;
  clientCapabilities: readonly string[];
};

/** Each advertised check with the provider POST would select for it. */
function advertisedImeiTiers({
  configuration,
  device,
  clientCapabilities,
}: CapabilitiesInput): { tierKey: ImeiServiceTierKey; provider: string }[] {
  if (
    !configuration.getImeiHashSalt() ||
    Buffer.byteLength(configuration.getAccessSigningSecret() ?? '') < 32
  ) {
    return [];
  }
  const disabled = new Set(configuration.getImeiDisabledTierKeys());
  const petrockEnabled = configuration.isPetrockEnabled();
  const petrockEnabledTiers = new Set(
    configuration.getPetrockEnabledTierKeys() as ImeiServiceTierKey[]
  );
  const petrockConfigured = Boolean(
    configuration.getPetrockConfig() &&
      configuration.getImeiIdentifierEncryptionKey()
  );
  const sickwConfigured = Boolean(configuration.getSickwApiKey());
  return PUBLIC_IMEI_SERVICE_TIERS.flatMap((tierKey) => {
    const tier = IMEI_SERVICE_TIERS[tierKey];
    if (
      disabled.has(tierKey) ||
      (device && !tier.deviceCategories.some((category) => category === device))
    ) {
      return [];
    }
    const binding = resolveImeiProviderBinding({
      clientSupportsAsync: clientCapabilities.includes('imei-async-v1'),
      deviceCategory: device,
      petrockEnabled,
      petrockEnabledTiers,
      tier,
      tierKey,
    });
    if (!binding) return [];
    // Match POST's selected provider exactly. Missing Petrock configuration
    // cannot advertise a Sickw fallback that POST would never select.
    const configured =
      binding.provider === 'petrock' ? petrockConfigured : sickwConfigured;
    return configured ? [{ tierKey, provider: binding.provider }] : [];
  });
}

export function getAvailableImeiTierKeys(
  input: CapabilitiesInput
): ImeiServiceTierKey[] {
  return advertisedImeiTiers(input).map(({ tierKey }) => tierKey);
}

/**
 * The advertised checks the savings wallet can pay for: wallet pay only
 * accepts Sickw-run checks, and which checks Petrock runs is server
 * configuration the app can't see, so the server says it here.
 */
export function getWalletPayableImeiTierKeys(
  input: CapabilitiesInput
): ImeiServiceTierKey[] {
  return advertisedImeiTiers(input)
    .filter(({ provider }) => provider === 'sickw')
    .map(({ tierKey }) => tierKey);
}
