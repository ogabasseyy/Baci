type ProductEntryPhase =
  | 'keyboard_hide_requested'
  | 'keyboard_hidden'
  | 'keyboard_hide_timeout'
  | 'waiting'
  | 'transition_start'
  | 'transition_end'
  | 'transition_fallback'
  | 'preview_layout'
  | 'preview_image_displayed'
  | 'details_layout';

/** Local benchmark markers contain no product or customer data. */
export function markProductEntryTiming(phase: ProductEntryPhase) {
  if (process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT !== 'benchmark') return;
  console.info('[ProductEntryTiming]', phase, Math.round(performance.now()));
}
