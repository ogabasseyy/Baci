import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';

/**
 * The checks the server can bill to the PiggyVest wallet, from the IMEI
 * capability reply. Null when the server does not say (an older server):
 * the app then keeps its own rule (no Petrock-only checks).
 */
export function parseImeiWalletPayableTiers(
  value: unknown
): ImeiServiceTierKey[] | null {
  if (!value || typeof value !== 'object') return null;
  const keys = (value as { walletPayableTierKeys?: unknown })
    .walletPayableTierKeys;
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string'))
    return null;
  return [
    ...new Set(
      keys.filter((key): key is ImeiServiceTierKey =>
        Object.hasOwn(IMEI_SERVICE_TIERS, key)
      )
    ),
  ];
}

export async function fetchImeiWalletPayableTiers({
  device,
  apiBaseUrl,
  fetchImpl = fetch,
  signal,
}: {
  device: ImeiDeviceCategory;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ImeiServiceTierKey[] | null> {
  const query = new URLSearchParams({
    device,
    clientCapabilities: 'imei-async-v1',
  });
  const response = await fetchImpl(
    `${apiBaseUrl.replace(/\/$/, '')}/api/storefront/imei-check?${query}`,
    { method: 'GET', cache: 'no-store', signal }
  );
  if (!response.ok) throw new Error('IMEI capability request failed');
  return parseImeiWalletPayableTiers(await response.json());
}
