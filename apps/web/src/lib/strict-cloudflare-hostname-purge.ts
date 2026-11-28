import 'server-only';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4/zones';
const DEFAULT_TIMEOUT_MS = 5000;

export type StrictCloudflarePurgeResult =
  | { ok: true }
  | { errorCode: string; ok: false; retryAfterSeconds?: number };

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.min(3600, Math.ceil(seconds)));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(
    0,
    Math.min(3600, Math.ceil((timestamp - Date.now()) / 1000))
  );
}

/** Strict single-batch host purge used only after Next and Vercel succeed. */
export async function strictCloudflareHostnamePurge(
  hostnames: readonly string[],
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    zoneId: explicitZoneId,
  }: { fetchImpl?: typeof fetch; timeoutMs?: number; zoneId?: string } = {}
): Promise<StrictCloudflarePurgeResult> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId =
    explicitZoneId?.trim() || process.env.CLOUDFLARE_ZONE_ID?.trim();
  if (!token || !zoneId) {
    return { errorCode: 'cloudflare_missing_configuration', ok: false };
  }
  const hosts = Array.from(new Set(hostnames));
  if (hosts.length === 0) return { ok: true };
  if (hosts.length > 30) {
    return { errorCode: 'cloudflare_hostname_limit_exceeded', ok: false };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `${CLOUDFLARE_API_BASE}/${encodeURIComponent(zoneId)}/purge_cache`,
      {
        body: JSON.stringify({ hosts }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
  } catch {
    return { errorCode: 'cloudflare_request_failed', ok: false };
  }
  if (!response.ok) {
    const retryAfter =
      response.status === 429
        ? retryAfterSeconds(response.headers.get('Retry-After'))
        : undefined;
    return {
      errorCode: `cloudflare_http_${response.status}`,
      ok: false,
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('success' in payload) ||
    payload.success !== true
  ) {
    return { errorCode: 'cloudflare_provider_rejected', ok: false };
  }
  return { ok: true };
}
