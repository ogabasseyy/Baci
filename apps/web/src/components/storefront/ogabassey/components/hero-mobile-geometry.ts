/**
 * Shared geometry classes for the mobile hero's first frame.
 *
 * Shared by the product-neutral PPR fallback and the sole carousel rendered
 * after the request-scoped publication guard. Matching these dimensions keeps
 * the streamed Hero transition stable without exposing product UI early.
 */

export const HERO_MOBILE_WRAPPER_CLASSES = 'md:hidden mb-4 order-1';

export const HERO_MOBILE_PANEL_CLASSES =
  'relative h-48 touch-pan-y overflow-hidden rounded-2xl bg-store-secondary shadow-2xl ring-1 ring-store-border/70';

export const HERO_MOBILE_SLIDE_GRID_CLASSES = 'absolute inset-0 grid grid-cols-5';

export const HERO_MOBILE_TEXT_COLUMN_CLASSES =
  'col-span-3 flex flex-col justify-center gap-1 px-5 py-4';

export const HERO_MOBILE_EYEBROW_CLASSES =
  'text-[9px] font-semibold uppercase tracking-[0.12em] text-store-primary';

export const HERO_MOBILE_TITLE_CLASSES =
  'line-clamp-3 text-[1.65rem] font-extrabold leading-[1.05] text-store-secondary-text';

export const HERO_MOBILE_PRICE_CLASSES =
  'text-[11px] font-semibold text-store-secondary-text';

export const HERO_MOBILE_CTA_CLASSES =
  'mt-2 inline-flex w-fit items-center rounded-full bg-store-primary px-4 py-1.5 text-[11px] font-bold text-store-on-primary shadow-sm';

export const HERO_MOBILE_IMAGE_COLUMN_CLASSES =
  'relative col-span-2 flex items-center justify-center p-2';

/** Controls row shown when the carousel has more than one slide — the real
 * hero is ~52px taller with it, so the fallback must reserve it too. */
export const HERO_MOBILE_CONTROLS_ROW_CLASSES =
  'mt-2 flex items-center gap-2 px-1';

export const HERO_MOBILE_CONTROL_TRACK_CLASSES = 'h-11 flex-1';

/** Geometry only — the call sites add their own fill (`bg-store-primary`). */
export const HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES =
  'h-11 min-w-11 rounded-full';

/** Minimum rendered height of the mobile utility card: outer p-2, the 44px
 * callout + gap, and the 80px option grid. Shared with the PPR fallback. */
export const HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS = 'min-h-[156px]';
