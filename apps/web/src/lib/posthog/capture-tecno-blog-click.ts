import { redactUrlQuery } from './boot-free-capture';
import type { PostHogEnv } from './config';
import { capturePublicBlogInteraction } from './public-blog-pageview';

export function captureTecnoBlogClick(
  href: string,
  env?: PostHogEnv,
  currentUrl = globalThis.location?.href
): void {
  if (!currentUrl) return;
  try {
    const page = new URL(redactUrlQuery(currentUrl));
    if (
      page.href !==
      'https://ogabassey.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored'
    )
      return;

    const destination = new URL(href);
    const tag = destination.searchParams.get('utm_content');
    const target = destination.origin + destination.pathname;
    const event =
      target ===
        'https://www.tecno-mobile.com/nga/phones/product-detail/product/camon-slim/' &&
      tag === 'learn_more'
        ? 'tecno_camon_slim_learn_more_clicked'
        : target === 'https://ng-store.tecno.com/' && tag === 'order_here'
          ? 'tecno_camon_slim_order_here_clicked'
          : null;
    if (event) capturePublicBlogInteraction(event, env, currentUrl);
  } catch {
    // Analytics must not affect outbound navigation.
  }
}
