import type { useToast } from '@/hooks/use-toast';
import { rewriteCartLinkUrl } from './rewrite-cart-link-url';

export interface ReportCartLinkTransferOutcomeInput {
  addedCount: number;
  firstAddedProductName: string | null;
  keptHigherQuantity: boolean;
  rejectedIds: string[];
  guestQuantities: Map<string, number> | undefined;
  toast: ReturnType<typeof useToast>['toast'];
}

/**
 * Success reporting for a cart-link transfer: the added-items toast,
 * the kept-quantities notice, and the handoff-URL rewrite that retains
 * only retryable stock failures. Split out of cart-link-transfer
 * (300-line module ceiling).
 */
export function reportCartLinkTransferOutcome({
  addedCount,
  firstAddedProductName,
  keptHigherQuantity,
  rejectedIds,
  guestQuantities,
  toast,
}: ReportCartLinkTransferOutcomeInput): void {
  if (addedCount > 0) {
    toast({
      title: addedCount === 1 ? 'Added to cart' : `${addedCount} items added`,
      description:
        addedCount === 1
          ? `${firstAddedProductName} has been added to your cart.`
          : `${addedCount} products have been added to your cart.`,
    });
  }

  if (keptHigherQuantity) {
    toast({
      title: 'Kept your cart quantities',
      description:
        'Your cart already had higher quantities for some items, so those were kept instead of the chat amounts. Chat decreases never lower website quantities.',
    });
  }

  // Keep only retryable stock failures in the handoff URL.
  window.history.replaceState(
    {},
    '',
    rewriteCartLinkUrl(window.location.href, guestQuantities, rejectedIds)
  );
}
