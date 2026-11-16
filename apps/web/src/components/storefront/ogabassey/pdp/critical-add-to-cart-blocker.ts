import { formatVariantAxisLabel } from './critical-variant-selector-options';

/**
 * Why the critical buy box cannot add to cart right now. The shopper
 * always sees this reason next to the button: a blocked button that
 * looks ready and says nothing reads as "Add to cart is broken".
 */
export type CriticalAddToCartBlocker =
  | { kind: 'missing-selection'; axes: string[]; message: string }
  | { kind: 'unconfirmed-selection'; axes: string[]; message: string }
  | { kind: 'offer-missing'; axes: string[]; message: string }
  | { kind: 'out-of-stock'; axes: string[]; message: string }
  | { kind: 'unavailable'; axes: string[]; message: string };

interface ResolveCriticalAddToCartBlockerInput {
  canAddToCart: boolean;
  maxQuantity: number | null;
  /** Visible option groups the shopper has not chosen from yet. */
  missingAxes: string[];
  /**
   * Required option groups the page does not show that are still
   * unresolved. Any visible choice resolves them, so the shopper is
   * pointed back at the visible groups.
   */
  missingHiddenAxes?: string[];
  /** Option groups the page shows, in display order. */
  visibleAxes?: string[];
  routeOfferMissingActive: boolean;
}

function joinAxisLabels(axes: string[]) {
  const labels = axes.map((axis) => formatVariantAxisLabel(axis).toLowerCase());
  if (labels.length <= 1) {
    return labels[0] ?? 'option';
  }

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function resolveCriticalAddToCartBlocker({
  canAddToCart,
  maxQuantity,
  missingAxes,
  missingHiddenAxes = [],
  routeOfferMissingActive,
  visibleAxes = [],
}: ResolveCriticalAddToCartBlockerInput): CriticalAddToCartBlocker | null {
  if (canAddToCart) {
    return null;
  }

  if (routeOfferMissingActive) {
    return {
      kind: 'offer-missing',
      axes: ['condition'],
      message: 'Choose a condition above to add this to your cart.',
    };
  }

  if (missingAxes.length > 0) {
    return {
      kind: 'missing-selection',
      axes: missingAxes,
      message: `Choose a ${joinAxisLabels(missingAxes)} above to add this to your cart.`,
    };
  }

  if (missingHiddenAxes.length > 0 && visibleAxes.length > 0) {
    return {
      kind: 'unconfirmed-selection',
      axes: visibleAxes,
      message: 'Tap your options above to confirm the exact version.',
    };
  }

  if (maxQuantity === 0) {
    return {
      kind: 'out-of-stock',
      axes: [],
      message: 'This item is out of stock right now.',
    };
  }

  return {
    kind: 'unavailable',
    axes: [],
    message:
      'This combination is not available. Choose another option above.',
  };
}

/**
 * Brings the option group the shopper still has to choose from into
 * view. On a phone the selectors sit a full screen above the button.
 * A blocker that names no rendered group moves nothing: the reason
 * beside the button is the whole answer.
 */
export function revealCriticalAddToCartBlocker(
  blocker: CriticalAddToCartBlocker
) {
  if (typeof document === 'undefined') {
    return;
  }

  const target = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-ogabassey-pdp-commerce-variant-axis]'
    )
  ).find((group) => blocker.axes.includes(group.dataset.axis ?? ''));
  if (!target) {
    return;
  }

  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target
    .querySelector<HTMLElement>('[data-ogabassey-pdp-commerce-variant-option]')
    ?.focus({ preventScroll: true });
}
