export const OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_MEDIA = '(max-width: 767.98px)';

export const OGABASSEY_PDP_PRIMARY_IMAGE_DESKTOP_MEDIA = '(min-width: 768px)';

export const OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_SIZES = 'calc(100vw - 32px)';

export const OGABASSEY_PDP_PRIMARY_IMAGE_DESKTOP_SIZES =
  '(max-width: 1023px) calc(100vw - 48px), (max-width: 1439px) calc(52.38vw - 131px), 636px';

export const OGABASSEY_PDP_PRIMARY_IMAGE_SIZES = `${OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_MEDIA} ${OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_SIZES}, ${OGABASSEY_PDP_PRIMARY_IMAGE_DESKTOP_SIZES}`;

export const OGABASSEY_PDP_PRIMARY_IMAGE_QUALITY = 35;

export const OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_QUALITY = 30;

export const OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_WIDTHS = [
  256, 384, 640, 750,
] as const;

export const OGABASSEY_PDP_PRIMARY_IMAGE_DESKTOP_PRELOAD_WIDTH = 640;

/**
 * Same-origin mobile preload fallback used by the PDP image helper endpoint.
 * Keep separate from `OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_HEADER_PRELOAD_WIDTH`,
 * which targets the actual mobile browser candidate selected from `sizes`.
 */
export const OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_PRELOAD_WIDTH = 750;

export const OGABASSEY_PDP_PRIMARY_IMAGE_PRELOAD_FALLBACK_WIDTH = 750;

/**
 * HTTP Link header mobile preload width. Lighthouse and DebugBear mobile
 * profiles choose the 1080w candidate for the PDP hero with the current `sizes`
 * expression and device DPR. Keep this aligned with the actual mobile LCP
 * candidate instead of the smaller same-origin profile fallback.
 */
export const OGABASSEY_PDP_PRIMARY_IMAGE_MOBILE_HEADER_PRELOAD_WIDTH = 1080;
