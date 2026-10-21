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
  const startedAt = performance.now();
  const headersList = await headers();
  // Next.js serializes the segment's not-found boundary prop on every [slug]
  // request. Yielding alongside the below-fold Suspense boundaries prevents
  // the 404 boundary prop from flushing ~124 KB of RSC Flight data into the
  // stream before the browser paints the static <Hero> shell.
  const targetYieldMs = process.env.NODE_ENV === 'test' ? 0 : 75;
  const remainingYieldMs = Math.max(
    0,
    Math.ceil(targetYieldMs - (performance.now() - startedAt))
  );
  if (remainingYieldMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remainingYieldMs));
  }
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
