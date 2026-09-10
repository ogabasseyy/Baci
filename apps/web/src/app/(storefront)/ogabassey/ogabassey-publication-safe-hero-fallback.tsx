import {
  OGABASSEY_HOME_LCP_SUPPORT,
  OGABASSEY_TITLE,
} from '@/config/ogabassey';
import { OGABASSEY_HOME_LCP_CRITICAL_CSS } from './ogabassey-home-lcp-critical-css';

interface OgabasseyPublicationSafeHeroFallbackProps {
  /**
   * Presence of a published slide-0 image URL means the static shell may paint
   * brand title + description as LCP text. Product images in this slot became
   * the Slow-4G LCP node (~7s). Brand copy only — no product names, prices,
   * links, or controls.
   */
  heroImageUrl?: string | null;
}

export function OgabasseyPublicationSafeHeroFallback({
  heroImageUrl,
}: OgabasseyPublicationSafeHeroFallbackProps) {
  return (
    <div
      className="ogabassey-home-lcp-root"
      data-ogabassey-publication-safe-hero-fallback="true"
    >
      <style>{OGABASSEY_HOME_LCP_CRITICAL_CSS}</style>
      <div aria-hidden="true" className="ogabassey-home-lcp-scrim" />
      <div className="ogabassey-home-lcp-inner">
        <div className="ogabassey-home-lcp-mobile">
          <div className="ogabassey-home-lcp-panel">
            {heroImageUrl ? (
              <div className="ogabassey-home-lcp-copy">
                <h1
                  className="ogabassey-home-lcp-title"
                  data-cwv-lcp-copy="home"
                >
                  {OGABASSEY_TITLE}
                </h1>
                <p
                  className="ogabassey-home-committed-lcp"
                  data-cwv-lcp-support=""
                  data-ogabassey-committed-lcp-copy="true"
                >
                  {OGABASSEY_HOME_LCP_SUPPORT}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
