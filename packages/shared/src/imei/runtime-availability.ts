import type { ImeiDeviceCategory } from './service-tier-types';
import { IMEI_SERVICE_TIERS, type ImeiServiceTierKey } from './service-tiers';

/** Unknown servers retain legacy checks; provider-only services need an explicit grant. */
export function filterRuntimeImeiTierKeys(
  candidates: readonly ImeiServiceTierKey[],
  availableTierKeys: readonly ImeiServiceTierKey[] | null
): ImeiServiceTierKey[] {
  return candidates.filter((key) =>
    availableTierKeys === null
      ? IMEI_SERVICE_TIERS[key].providerServiceId !== 'petrock-only'
      : availableTierKeys.includes(key)
  );
}

export function parseRuntimeImeiTierKeys(value: unknown): ImeiServiceTierKey[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('availableTierKeys' in value) ||
    !Array.isArray(value.availableTierKeys) ||
    !value.availableTierKeys.every((key) => typeof key === 'string')
  ) {
    throw new Error('Invalid IMEI capability response');
  }
  return [
    ...new Set(
      value.availableTierKeys.filter((key): key is ImeiServiceTierKey =>
        Object.keys(IMEI_SERVICE_TIERS).includes(key)
      )
    ),
  ];
}

export async function fetchRuntimeImeiTierKeys({
  device,
  apiBaseUrl = '',
  fetchImpl = fetch,
  signal,
}: {
  device: ImeiDeviceCategory;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ImeiServiceTierKey[]> {
  const query = new URLSearchParams({
    device,
    clientCapabilities: 'imei-async-v1',
  });
  const response = await fetchImpl(
    `${apiBaseUrl.replace(/\/$/, '')}/api/storefront/imei-check?${query}`,
    {
      method: 'GET',
      cache: 'no-store',
      signal,
    }
  );
  if (!response.ok) throw new Error('IMEI capability request failed');
  return parseRuntimeImeiTierKeys(await response.json());
}
