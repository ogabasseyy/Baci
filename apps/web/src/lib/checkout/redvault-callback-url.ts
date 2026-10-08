type RedvaultCallbackUrlInput = {
  merchantSlug: string;
  protocol: 'http' | 'https';
  rootDomain: string;
  runtimeEnv?: string;
  vercelEnv?: string;
  vercelUrl?: string;
  localBaseUrl?: string;
};

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const ROOT_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export function getRedvaultCallbackUrl({
  merchantSlug,
  protocol,
  rootDomain,
  runtimeEnv,
  vercelEnv,
  vercelUrl,
  localBaseUrl,
}: RedvaultCallbackUrlInput): string {
  if (!HOSTNAME_LABEL.test(merchantSlug)) {
    throw new Error('REDVAULT callback host is unavailable');
  }
  if (runtimeEnv === 'staging' && vercelEnv === 'preview') {
    if (!ROOT_DOMAIN.test(rootDomain)) {
      throw new Error('REDVAULT callback host is unavailable');
    }
    if (
      !vercelUrl ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(vercelUrl)
    ) {
      throw new Error('REDVAULT Preview callback host is unavailable');
    }
    return `https://${vercelUrl}/${encodeURIComponent(merchantSlug)}/checkout/success`;
  }
  if (runtimeEnv === 'staging' && vercelEnv !== 'preview') {
    // Local staging has no Vercel Preview host and may have no root
    // domain at all; route the test callback at an explicitly provided
    // loopback base URL instead of emitting an unresolvable merchant
    // domain (or rejecting outright when the root domain is unset).
    let origin: string | null = null;
    try {
      const parsed = new URL(localBaseUrl ?? '');
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname)
      ) {
        origin = parsed.origin;
      }
    } catch {
      origin = null;
    }
    if (!origin) {
      throw new Error('REDVAULT local callback host is unavailable');
    }
    return `${origin}/${encodeURIComponent(merchantSlug)}/checkout/success`;
  }

  if (!ROOT_DOMAIN.test(rootDomain)) {
    throw new Error('REDVAULT callback host is unavailable');
  }
  return `${protocol}://${merchantSlug}.${rootDomain}/checkout/success`;
}
