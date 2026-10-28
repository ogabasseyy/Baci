import ReactDOM from 'react-dom';
import { OGABASSEY_CDN_ORIGIN } from '@/components/storefront/ogabassey/config/storefront-origins';

/**
 * Warms DNS for the Ogabassey media CDN during the static shell flush.
 * The HTTP `Link` response header already preconnects to the CDN origin, so
 * emitting a late `ReactDOM.preconnect` here would only trigger an unused
 * preconnect warning in Lighthouse.
 */
export function OgabasseyStaticResourceHints() {
  ReactDOM.prefetchDNS(OGABASSEY_CDN_ORIGIN);
  return null;
}
