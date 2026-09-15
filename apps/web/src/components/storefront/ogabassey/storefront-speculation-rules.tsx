'use client';

import { useEffect } from 'react';
import { safeJsonLdStringify } from '@/lib/sanitize-json-ld';
import { buildStorefrontSpeculationRules } from '@/lib/storefront/speculation-rules';

interface StorefrontSpeculationRulesProps {
  /**
   * '' on a custom domain (ogabassey.com) or `/${slug}` in path-routing mode
   * (usebaci.com/${slug}); every emitted URLPattern is prefixed with it.
   */
  basePath: string;
}

/**
 * Registers rules after hydration using a fresh native script. Scripts moved
 * through streaming HTML insertion can be ignored by Chrome; merely having
 * a script in the React subtree does not prove registration.
 *
 * Mounted from the OgaBassey template layout: the URL
 * patterns are template-structural (PDP = `/:category/:product`, listing =
 * `/:category`), so they apply to any merchant on this template. The storefront
 * CSP allows inline scripts (`script-src 'unsafe-inline'`), so no nonce is
 * needed; admin/auth routes use a strict nonce CSP and never mount this.
 *
 * Serialization: `safeJsonLdStringify` is the repo's script-context-safe JSON
 * serializer (escapes `<`, `>`, `&`, U+2028/U+2029), so the emitted JSON can
 * never break out of the `<script>` element. Values here are fixed constants
 * plus a validated slug, so there is no user input, but the escaping keeps the
 * output robust regardless.
 *
 * Prerendered pages execute JS; the storefront's side effects that would
 * corrupt state or mint junk data for a page the shopper may never open —
 * PostHog idle boot, web-vitals flush, ad-attribution capture, merchant
 * page-view tracker, deferred cart validation/persistence, v2 saved-list
 * hydration/persistence, and the Google merchant widget — are each gated on
 * `document.prerendering` (see `runWhenPageActivated`), so speculating a
 * PDP/listing never mutates the cart or saved list, loads third-party widgets,
 * or mints junk pageviews/attribution.
 */
export function StorefrontSpeculationRules({
  basePath,
}: StorefrontSpeculationRulesProps) {
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'speculationrules';
    script.textContent = safeJsonLdStringify(
      buildStorefrontSpeculationRules(basePath)
    );
    document.head.append(script);
    return () => script.remove();
  }, [basePath]);

  return null;
}
