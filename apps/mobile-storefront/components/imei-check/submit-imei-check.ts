import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';

export async function submitImeiCheck({
  accessToken,
  apiBaseUrl,
  device,
  fetchImpl = fetch,
  idempotencyKey,
  identifier,
  previousLookupId,
  signal,
  tier,
}: {
  accessToken?: string;
  apiBaseUrl: string;
  device: ImeiDeviceCategory;
  fetchImpl?: typeof fetch;
  idempotencyKey: string;
  identifier: string;
  previousLookupId?: string;
  signal: AbortSignal;
  tier: ImeiServiceTierKey;
}) {
  const response = await fetchImpl(`${apiBaseUrl}/api/storefront/imei-check`, {
    body: JSON.stringify({
      clientCapabilities: ['imei-async-v1', 'imei-attempt-coordination-v1'],
      device,
      imei: identifier,
      ...(previousLookupId ? { previousLookupId } : {}),
      tier,
    }),
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    method: 'POST',
    signal,
  });

  return { rawData: await response.json(), response };
}
