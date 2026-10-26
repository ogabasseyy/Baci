import { OGABASSEY_HOME_HEADER_CHROME_CRITICAL_CSS } from '@/app/(storefront)/ogabassey/ogabassey-home-chrome-critical-css';

/** Delivered with this template's markup, never the tenant-neutral shell. */
export function OgabasseyHeaderCriticalStyle() {
  return (
    <style href="ogabassey-header-critical" precedence="high">
      {OGABASSEY_HOME_HEADER_CHROME_CRITICAL_CSS}
    </style>
  );
}
