import 'server-only';

import {
  type CloudflareCustomHostname,
  cloudflareDeleteEnvelopeSchema,
  cloudflareListEnvelopeSchema,
  cloudflareSingleEnvelopeSchema,
  type DomainVerificationRecord,
} from '@/schemas/cloudflare-saas';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4/zones';
const DEFAULT_TIMEOUT_MS = 5000;
export const CLOUDFLARE_SAAS_CNAME_TARGET = 'customers.usebaci.com';

export interface CloudflareSaasConfig {
  apiToken: string;
  zoneId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class CloudflareSaasError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = 'CloudflareSaasError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function readCloudflareSaasConfig(): CloudflareSaasConfig | null {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = process.env.CLOUDFLARE_SAAS_ZONE_ID?.trim();
  if (!apiToken || !zoneId) return null;
  return { apiToken, zoneId };
}

function buildAuthHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };
}

export function extractCloudflareVerificationRecords(
  hostname: string,
  remote: CloudflareCustomHostname | null
): DomainVerificationRecord[] {
  const records: DomainVerificationRecord[] = [
    {
      name: hostname,
      purpose: 'routing',
      status: remote?.status === 'active' ? 'verified' : 'pending',
      type: 'CNAME',
      value: CLOUDFLARE_SAAS_CNAME_TARGET,
    },
  ];

  if (
    remote?.ownership_verification?.name &&
    remote.ownership_verification.value
  ) {
    records.push({
      name: remote.ownership_verification.name,
      purpose: 'cloudflare_ownership',
      status: remote.status === 'active' ? 'verified' : 'pending',
      type: 'TXT',
      value: remote.ownership_verification.value,
    });
  }

  for (const dcv of remote?.ssl?.validation_records ?? []) {
    if (dcv.txt_name && dcv.txt_value) {
      records.push({
        name: dcv.txt_name,
        purpose: 'cloudflare_ssl_dcv',
        status: remote?.ssl?.status === 'active' ? 'verified' : 'pending',
        type: 'TXT',
        value: dcv.txt_value,
      });
    }
  }

  return records;
}

export async function findCloudflareCustomHostnameByName(
  hostname: string,
  config: CloudflareSaasConfig
): Promise<CloudflareCustomHostname | null> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const normalized = hostname.trim().toLowerCase();
  const url = `${CLOUDFLARE_API_BASE}/${encodeURIComponent(config.zoneId)}/custom_hostnames?hostname=${encodeURIComponent(normalized)}`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: buildAuthHeaders(config.apiToken),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new CloudflareSaasError(
      'cloudflare_lookup_failed',
      `Cloudflare lookup returned HTTP ${response.status}`,
      response.status
    );
  }

  const parsed = cloudflareListEnvelopeSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (!parsed.success || !parsed.data.success) {
    throw new CloudflareSaasError(
      'cloudflare_invalid_response',
      'Cloudflare custom hostname lookup returned an invalid payload'
    );
  }

  const exact = (parsed.data.result ?? []).find(
    (item) => item.hostname.toLowerCase() === normalized
  );
  return exact ?? null;
}

export async function getCloudflareCustomHostname(
  cloudflareHostnameId: string,
  config: CloudflareSaasConfig
): Promise<CloudflareCustomHostname | null> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${CLOUDFLARE_API_BASE}/${encodeURIComponent(config.zoneId)}/custom_hostnames/${encodeURIComponent(cloudflareHostnameId)}`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: buildAuthHeaders(config.apiToken),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new CloudflareSaasError(
      'cloudflare_get_failed',
      `Cloudflare GET custom hostname returned HTTP ${response.status}`,
      response.status
    );
  }

  const parsed = cloudflareSingleEnvelopeSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (!parsed.success || !parsed.data.success || !parsed.data.result) {
    throw new CloudflareSaasError(
      'cloudflare_invalid_response',
      'Cloudflare GET custom hostname returned an invalid payload'
    );
  }

  return parsed.data.result;
}

export async function createCloudflareCustomHostname(
  hostname: string,
  config: CloudflareSaasConfig
): Promise<CloudflareCustomHostname> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const normalized = hostname.trim().toLowerCase();
  const url = `${CLOUDFLARE_API_BASE}/${encodeURIComponent(config.zoneId)}/custom_hostnames`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: buildAuthHeaders(config.apiToken),
    body: JSON.stringify({
      hostname: normalized,
      ssl: {
        method: 'txt',
        type: 'dv',
        settings: {
          min_tls_version: '1.2',
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new CloudflareSaasError(
      'cloudflare_create_failed',
      `Cloudflare create custom hostname returned HTTP ${response.status}`,
      response.status
    );
  }

  const parsed = cloudflareSingleEnvelopeSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (!parsed.success || !parsed.data.success || !parsed.data.result) {
    throw new CloudflareSaasError(
      'cloudflare_invalid_response',
      'Cloudflare create custom hostname returned an invalid payload'
    );
  }

  return parsed.data.result;
}

/**
 * Verifies that the remote Cloudflare custom hostname in `config.zoneId`
 * matches `expectedHostname` before deleting it. Returns `{ deleted: true }`
 * when removed or already absent (404).
 */
export async function deleteCloudflareCustomHostnameVerified(
  expectedHostname: string,
  cloudflareHostnameId: string | null,
  config: CloudflareSaasConfig
): Promise<{ deleted: true; resolvedId: string | null }> {
  const normalized = expectedHostname.trim().toLowerCase();
  const remote = cloudflareHostnameId
    ? await getCloudflareCustomHostname(cloudflareHostnameId, config)
    : await findCloudflareCustomHostnameByName(normalized, config);

  if (!remote) {
    return { deleted: true, resolvedId: null };
  }

  if (remote.hostname.toLowerCase() !== normalized) {
    throw new CloudflareSaasError(
      'cloudflare_hostname_mismatch',
      `Refusing to delete Cloudflare hostname ${remote.id}: remote hostname does not match expected target`
    );
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${CLOUDFLARE_API_BASE}/${encodeURIComponent(config.zoneId)}/custom_hostnames/${encodeURIComponent(remote.id)}`;

  const response = await fetchImpl(url, {
    method: 'DELETE',
    headers: buildAuthHeaders(config.apiToken),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 404) {
    return { deleted: true, resolvedId: remote.id };
  }

  if (!response.ok) {
    throw new CloudflareSaasError(
      'cloudflare_delete_failed',
      `Cloudflare DELETE custom hostname returned HTTP ${response.status}`,
      response.status
    );
  }

  const parsed = cloudflareDeleteEnvelopeSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (!parsed.success || !parsed.data.success) {
    throw new CloudflareSaasError(
      'cloudflare_invalid_response',
      'Cloudflare DELETE custom hostname returned an invalid payload'
    );
  }

  return { deleted: true, resolvedId: remote.id };
}
