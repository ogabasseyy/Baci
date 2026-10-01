import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-home.css';
import { OGABASSEY_TITLE } from '@/config/ogabassey';
import { OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS } from './ogabassey-home-carousel-critical-css';
import { OGABASSEY_HOME_CHROME_CRITICAL_CSS } from './ogabassey-home-chrome-critical-css';
import { OGABASSEY_HOME_LCP_CRITICAL_CSS } from './ogabassey-home-lcp-critical-css';

/** Styles and document semantics only; the publication-checked Hero owns the banner. */
export function OgabasseyHomeCriticalShell() {
  return (
    <>
      <style>{OGABASSEY_HOME_LCP_CRITICAL_CSS}</style>
      <style>{OGABASSEY_HOME_CHROME_CRITICAL_CSS}</style>
      <style>{OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS}</style>
      <h1 className="sr-only">{OGABASSEY_TITLE}</h1>
    </>
  );
}
