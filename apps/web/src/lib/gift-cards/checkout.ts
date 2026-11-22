export interface GiftCardCheckoutQuote {
  id: string;
  cardId: string;
  totalKobo: number;
  expiresAt: number;
}

export type GiftCardPurchaseStatus =
  | { status: 'expired' | 'insufficient' | 'unknown' | 'submitting' }
  | { status: 'submitted'; orderId: string };

type SubmissionOutcome =
  | { status: 'unknown' }
  | { status: 'submitted'; orderId: string };

type WalletClaim = GiftCardPurchaseStatus | { status: 'claimed' };

export interface GiftCardWallet {
  // A real adapter must atomically debit and record the supplier attempt.
  claim(
    quote: GiftCardCheckoutQuote,
    now: number
  ): WalletClaim | Promise<WalletClaim>;
  finish(quoteId: string, outcome: SubmissionOutcome): void | Promise<void>;
}

export async function confirmGiftCardPurchase(
  quote: GiftCardCheckoutQuote,
  wallet: GiftCardWallet,
  submit: (order: {
    cardId: string;
    reference: string;
  }) => Promise<{ orderId: string }>,
  now = Date.now
): Promise<GiftCardPurchaseStatus> {
  const claim = await wallet.claim(quote, now());
  if (claim.status !== 'claimed') return claim;

  let outcome: SubmissionOutcome = { status: 'unknown' };
  try {
    const { orderId } = await submit({
      cardId: quote.cardId,
      reference: quote.id,
    });
    const trimmedOrderId = orderId.trim();
    if (trimmedOrderId)
      outcome = { status: 'submitted', orderId: trimmedOrderId };
  } catch {
    // A lost response may still mean Petrock accepted the order.
  }

  await wallet.finish(quote.id, outcome);
  return outcome;
}
