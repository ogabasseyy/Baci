import { Check, Copy } from 'lucide-react';
import type { StorefrontOrderData as OrderData } from './fetch-storefront-order';
import type { PayerHandoff } from './order-success-payer-handoff';

/**
 * Payer handoff (Pay for Me only): copyable payment instructions the
 * requester forwards — amount plus transfer details, with no Bearer [REDACTED],
 * no link, and no PII.
 */
export function OrderSuccessPayerHandoff({
  handoff,
  order,
  payerDetailsCopied,
  onCopied,
}: {
  handoff: PayerHandoff;
  order: OrderData;
  payerDetailsCopied: boolean;
  onCopied: (ok: boolean) => void;
}) {
  const {
    isPayForMeUnpaid,
    payerAmountText,
    payerDetailsText,
    payerName,
    payerOutstandingBalance,
    payerTransferAccount,
  } = handoff;
  if (!isPayForMeUnpaid || !payerDetailsText) {
    return null;
  }
  return (
    <div className="mb-8 rounded-2xl border border-store-border bg-store-secondary p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-widest text-store-background-text/55 mb-2">
        Payment details for {payerName}
      </p>
      <dl className="rounded-lg border border-store-border bg-store-background px-3 py-2.5 text-sm text-store-background-text space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-store-background-text/55">Amount due</dt>
          <dd className="font-bold text-store-background-text">
            {payerAmountText}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-store-background-text/55">Order</dt>
          <dd className="font-mono font-bold text-store-background-text">
            {order.order_number}
          </dd>
        </div>
        {payerTransferAccount && (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-store-background-text/55">Bank</dt>
              <dd className="font-bold text-store-background-text">
                {payerTransferAccount.bank_name || 'See your order email'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-store-background-text/55">Account name</dt>
              <dd className="font-bold text-store-background-text">
                {payerTransferAccount.account_name || 'See your order email'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-store-background-text/55">Account number</dt>
              <dd className="font-mono font-bold text-store-background-text">
                {payerTransferAccount.account_number}
              </dd>
            </div>
          </>
        )}
      </dl>
      {!payerTransferAccount && payerOutstandingBalance > 0 && (
        <p className="mt-2 text-xs text-store-background-text/55">
          Your order email has the full transfer details — forward them to{' '}
          {payerName} along with the amount above.
        </p>
      )}
      <button
        type="button"
        aria-label="Copy payment details to share with your payer"
        onClick={() => {
          void navigator.clipboard?.writeText(payerDetailsText).then(
            () => onCopied(true),
            () => onCopied(false)
          );
        }}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-store-primary px-4 py-2.5 text-sm font-bold text-store-primary-text hover:bg-store-primary/90 active:scale-[0.98]"
      >
        {payerDetailsCopied ? <Check size={16} /> : <Copy size={16} />}
        {payerDetailsCopied ? 'Copied' : 'Copy details'}
      </button>
    </div>
  );
}
