/**
 * Shared shape for a same-origin hero snapshot: a set of pre-encoded AVIF
 * files served from this origin (`/_hero/<slug>/…`) that stand in for one
 * CDN source URL's AVIF tier.
 *
 * Neutral module: imported by server render paths and by the client-bundled
 * mobile hero image alike, so it must stay free of `server-only`, node APIs,
 * and env reads. Resolution (flag gate, tenant gate, exact-URL match) lives
 * in `@/lib/ogabassey-home-hero-snapshot`; render sites only consume the
 * resolved value and re-check `sourceUrl` before using it.
 */
export interface OgabasseyHomeHeroSnapshot {
  /** Exact CDN source URL this snapshot was baked from. Render sites must
   *  only use the snapshot when this equals the slide URL being rendered —
   *  this is the last-mile rotation guard. */
  sourceUrl: string;
  /** Responsive same-origin AVIF set, e.g.
   *  `/_hero/ogabassey/<hash>-640.avif 640w, …`. Passed verbatim to
   *  `imageSrcSet`/`<source srcSet>` so preload and picture stay deduped. */
  srcSet: string;
  /** Nearest-to-960w file, for the preload `href` fallback. Responsive
   *  selection uses `srcSet`; `href` only matters when srcset matching
   *  cannot apply. */
  href: string;
}
