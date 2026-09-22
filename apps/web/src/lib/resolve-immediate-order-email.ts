type ImmediateOrderEmailDocumentKind =
  | 'confirmation'
  | 'proforma'
  | 'payment_request';

interface ResolveImmediateOrderEmailInput {
  effectivePaymentMethod: string;
  isWalletFullyPaid: boolean;
  isQuizVoucherFullyPaid: boolean;
  orderPaymentStatus?: string | null;
  requestPaymentStatus?: string | null;
  paymentStatus?: string | null;
  amountPaid?: number | null;
  orderNumber: string;
}

interface ResolvedImmediateOrderEmail {
  documentKind: ImmediateOrderEmailDocumentKind;
  isPaidForEmail: boolean;
  subject: string;
}

/**
 * Single classification behind the immediate order email. Wallet and
 * quiz-voucher full coverage finalize payment server-side, but the
 * create-RPC row still carries the pre-coverage status, so the paid
 * state derives from the coverage flags — subject, body kind, PDF kind,
 * and Peppol type code all share it. Unpaid invoice-method orders are
 * proforma (325) quotations (quotation semantics); unpaid Pay for Me
 * orders are payment requests (request, not quotation, semantics).
 */
export function resolveImmediateOrderEmail({
  effectivePaymentMethod,
  isWalletFullyPaid,
  isQuizVoucherFullyPaid,
  orderPaymentStatus,
  requestPaymentStatus,
  paymentStatus,
  amountPaid,
  orderNumber,
}: ResolveImmediateOrderEmailInput): ResolvedImmediateOrderEmail {
  const isPaidForEmail =
    isWalletFullyPaid ||
    isQuizVoucherFullyPaid ||
    String(orderPaymentStatus || requestPaymentStatus || '').toLowerCase() ===
      'paid';
  // Same prior-payment evidence as the invoice-type resolver: a
  // partially paid status or a positive credited balance means the
  // invoice already accepted value, so the email is a commercial
  // confirmation with the outstanding balance — never a quotation.
  // isPaidForEmail stays strict (fully paid only): partial credit must
  // not mark the receipt paid.
  const status = paymentStatus?.trim().toLowerCase();
  const creditedAmount = Number(amountPaid ?? 0);
  const previouslyPaid =
    status === 'partially_paid' ||
    (Number.isFinite(creditedAmount) && creditedAmount > 0);
  const documentKind =
    effectivePaymentMethod === 'invoice' && !isPaidForEmail && !previouslyPaid
      ? ('proforma' as const)
      : effectivePaymentMethod === 'payforme' && !isPaidForEmail
        ? ('payment_request' as const)
        : ('confirmation' as const);
  // Derived from the payment/paid classification (same rule as the body
  // and the Peppol type code): a failed attachment block must not flip
  // the subject to commercial.
  const subject =
    effectivePaymentMethod === 'invoice'
      ? `${documentKind === 'proforma' ? 'Proforma Invoice' : 'Invoice'} Generated - #${orderNumber}`
      : effectivePaymentMethod === 'payforme'
        ? // A fully-funded Pay for Me order is a confirmation, not a
          // request: its subject must match the confirmed body instead of
          // prompting the requester to seek payment again.
          `${documentKind === 'payment_request' ? 'Payment Request' : 'Order Confirmation'} - #${orderNumber}`
        : `Order Confirmation - #${orderNumber}`;
  return { documentKind, isPaidForEmail, subject };
}
