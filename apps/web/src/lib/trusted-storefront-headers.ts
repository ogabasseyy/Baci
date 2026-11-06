import { normalizeStorefrontHeader } from '@/lib/normalize-storefront-header';

type StorefrontHeaderReader = {
  headers: {
    get(name: string): string | null;
  };
};

function normalizeStorefrontHost(value: string | null): string {
  return (value ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
}

export function hasTrustedStorefrontHeaders(
  request: StorefrontHeaderReader
): boolean {
  const host = normalizeStorefrontHost(request.headers.get('host'));
  const slug = normalizeStorefrontHeader(
    request.headers.get('x-merchant-slug')
  );
  const domain = normalizeStorefrontHeader(
    request.headers.get('x-merchant-domain')
  );
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
  ).toLowerCase();

  if (domain && (host === domain || host === `www.${domain}`)) {
    return true;
  }

  if (!slug) return false;

  return (
    host === `${slug}.${rootDomain}` ||
    host === `${slug}.localhost` ||
    host.startsWith(`${slug}.localhost:`)
  );
}
