import type { CriticalAddToCartBlocker } from './critical-add-to-cart-blocker';

/**
 * Brings the option group the shopper still has to choose from into
 * view. On a phone the selectors sit a full screen above the button.
 * A blocker that names no rendered group moves nothing: the reason
 * beside the button is the whole answer. `origin` is the tapped button:
 * the lookup stays inside its own product section, so a second buy box
 * on the page is never scrolled or focused by mistake.
 */
export function revealCriticalAddToCartBlocker(
  blocker: CriticalAddToCartBlocker,
  origin?: Element | null
) {
  if (typeof document === 'undefined') {
    return;
  }

  const scope: ParentNode =
    origin?.closest('[data-ogabassey-pdp-critical-shell]') ?? document;
  const target = Array.from(
    scope.querySelectorAll<HTMLElement>(
      '[data-ogabassey-pdp-commerce-variant-axis]'
    )
  ).find((group) => blocker.axes.includes(group.dataset.axis ?? ''));
  if (!target) {
    return;
  }

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  target.scrollIntoView?.({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'center',
  });
  // Land on an option not already chosen. The selectors render no
  // disabled options today; the guard keeps focus off one if they do.
  const option =
    target.querySelector<HTMLElement>(
      '[data-ogabassey-pdp-commerce-variant-option]:not([data-selected="true"]):not(:disabled)'
    ) ??
    target.querySelector<HTMLElement>(
      '[data-ogabassey-pdp-commerce-variant-option]:not(:disabled)'
    );
  option?.focus({ preventScroll: true });
}
