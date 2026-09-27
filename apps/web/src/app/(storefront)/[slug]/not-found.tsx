import { headers } from 'next/headers';
import { resolveKnownStorefrontAppearance } from '@/components/storefront/storefront-appearance';
import { StorefrontThemeProvider } from '@/components/storefront/storefront-theme-provider';
import { StorefrontNotFoundContent } from './storefront-not-found-content';

function normalizeHostHeader(rawHost: string | null): string {
  return (
    rawHost?.split(',')[0]?.trim().replace(/:\d+$/, '').toLowerCase() ?? ''
  );
}

function resolveStorefrontNotFoundAppearance(headersList: Headers) {
  const candidates = [
    headersList.get('x-merchant-slug'),
    normalizeHostHeader(headersList.get('x-custom-domain')),
    normalizeHostHeader(headersList.get('x-forwarded-host')),
    normalizeHostHeader(headersList.get('host')),
  ];

  for (const candidate of candidates) {
    const appearance = resolveKnownStorefrontAppearance(candidate);
    if (appearance) {
      return appearance;
    }
  }

  return null;
}

export default async function StorefrontNotFound() {
  const headersList = await headers();
  const appearance = resolveStorefrontNotFoundAppearance(headersList);
  const content = <StorefrontNotFoundContent />;

  if (!appearance) {
    return content;
  }

  return (
    <StorefrontThemeProvider appearance={appearance}>
      {content}
    </StorefrontThemeProvider>
  );
}
