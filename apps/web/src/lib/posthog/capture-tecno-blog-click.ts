import { redactUrlQuery } from './boot-free-capture';
import type { PostHogEnv } from './config';
import { isTecnoSponsoredBlogUrl } from './is-tecno-sponsored-blog-url';
import { capturePublicBlogInteraction } from './public-blog-pageview';

// Canonical HTTPS destination URLs expected on CTA links (normalized without
// trailing slash except root, paired with lowercase utm_content tags).
const TECNO_LEARN_MORE_TARGET =
  'https://www.tecno-mobile.com/nga/phones/product-detail/product/camon-slim';
const TECNO_ORDER_HERE_TARGET = 'https://ng-store.tecno.com/';

function normalizeOriginAndPathname(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin.toLowerCase()}${pathname}`;
}

export function captureTecnoBlogClick(
  href: string,
  env?: PostHogEnv,
  currentUrl = globalThis.location?.href
): void {
  if (!currentUrl) return;
  try {
    if (!isTecnoSponsoredBlogUrl(redactUrlQuery(currentUrl))) return;

    const destination = new URL(href);
    const tag = destination.searchParams.get('utm_content')?.toLowerCase();
    const target = normalizeOriginAndPathname(destination);
    const event =
      target === TECNO_LEARN_MORE_TARGET && tag === 'learn_more'
        ? 'tecno_camon_slim_learn_more_clicked'
        : target === TECNO_ORDER_HERE_TARGET && tag === 'order_here'
          ? 'tecno_camon_slim_order_here_clicked'
          : null;
    if (event) capturePublicBlogInteraction(event, env, currentUrl);
  } catch {
    // Analytics must not affect outbound navigation.
  }
}
