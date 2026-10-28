export const MOBILE_HERO_IMAGE_WIDTH = 960;
export const MOBILE_HERO_IMAGE_HEIGHT = 540;
// The mobile hero image renders in HERO_MOBILE_IMAGE_COLUMN_CLASSES
// ('col-span-2' of grid-cols-5 = 40% of the px-4 container ≈ 37vw at 412px).
// Declaring 100vw here made the browser pick the width=1200 srcset candidate
// (~90KB) for a ~152 CSS-px slot — on Slow-4G that oversize WAS the ~6s lab
// LCP (DebugBear waterfall 2026-07-10). 40vw selects width=640 (~25KB) at
// DPR≈2.6; slightly over-provisioned on purpose (over = safe, under = blurry).
export const MOBILE_HERO_IMAGE_SIZES = '(max-width: 767px) 40vw, 50vw';
export const MOBILE_HERO_SOURCE_MEDIA = '(max-width: 767px)';
export const DESKTOP_HERO_SOURCE_MEDIA = '(min-width: 768px)';
export const MOBILE_HERO_IMAGE_QUALITY = 70;
export const MOBILE_HERO_MIN_SRCSET_WIDTH = 384;
export const MOBILE_HERO_MAX_SRCSET_WIDTH = 750;
export const DESKTOP_HERO_BIG_MIN_SRCSET_WIDTH = 640;
export const DESKTOP_HERO_BIG_MAX_SRCSET_WIDTH = 1080;
export const DESKTOP_HERO_SIDE_MAX_SRCSET_WIDTH = 384;
export const TRANSPARENT_PIXEL_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
