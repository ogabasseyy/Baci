'use client';

import { useAssuranceDefaultNote } from '@/hooks/cart/use-assurance-default-note';

interface AssuranceDefaultNoteProps {
  canPurchase: boolean;
  /**
   * Units of this exact selection already in the cart. The note shows
   * only for fresh adds: merged adds keep the stored line choice, so a
   * note there could contradict an opt-out. Surfaces without an
   * exact-selection count omit this and show on rule-match; the note
   * then also renders for merge adds, which still disclose where the
   * fee is reviewed.
   */
  quantityInCart?: number;
  className?: string;
}

/**
 * Discloses the assurance default at the add-to-cart surface: when a
 * fresh add would default the fee on, the shopper sees which policy
 * applies and where to review or remove it before paying. The cart
 * line itself shows the exact fee with a toggle.
 */
export function AssuranceDefaultNote({
  canPurchase,
  quantityInCart,
  className,
}: AssuranceDefaultNoteProps) {
  const { visible, label } = useAssuranceDefaultNote();
  if (
    !visible ||
    !canPurchase ||
    (quantityInCart !== undefined && quantityInCart !== 0)
  ) {
    return null;
  }
  return (
    <p data-testid="assurance-default-note" className={className}>
      Includes {label} — review or remove it in your cart.
    </p>
  );
}
