/**
 * Shared grid constants. Dedicated module per the repository's
 * dedicated-constants requirement: the static fallback default, the
 * swap-tier predicate, and the grid's paging all read these, so a
 * merchandising change lands in one place.
 */

/**
 * How many leading fallback cards render a real `<img>`. The remaining
 * cards render the same placeholder shell the interactive card shows
 * pre-activation, so below-fold product images never compete with LCP
 * for bandwidth.
 */
export const FALLBACK_RENDERED_IMAGE_COUNT = 2;

/** Products appended per load-more expansion (and per replayed tap). */
export const PRODUCTS_PER_PAGE = 20;
