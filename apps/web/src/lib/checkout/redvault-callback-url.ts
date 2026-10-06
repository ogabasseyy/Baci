type RedvaultCallbackUrlInput = {
  merchantSlug: string;
  protocol: 'http' | 'https';
  rootDomain: string;
  runtimeEnv?: string;
  vercelEnv?: string;
  vercelUrl?: string;
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
}: RedvaultCallbackUrlInput): string {
  if (!HOSTNAME_LABEL.test(merchantSlug) || !ROOT_DOMAIN.test(rootDomain)) {
    throw new Error('REDVAULT callback host is unavailable');
  }
  if (runtimeEnv === 'staging' && vercelEnv === 'preview') {
    if (
      !vercelUrl ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(vercelUrl)
    ) {
      throw new Error('REDVAULT Preview callback host is unavailable');
    }
    return `https://${vercelUrl}/${encodeURIComponent(merchantSlug)}/checkout/success`;
  }

  return `${protocol}://${merchantSlug}.${rootDomain}/checkout/success`;
}
