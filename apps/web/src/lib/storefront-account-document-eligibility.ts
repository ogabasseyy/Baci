import {
  isManualOrderRecord,
  isNonNegativeMoney,
  isSettledManualBalance,
} from '@baci/shared/receipt';
import type {
  ManualDocumentArchiveItem,
  ManualDocumentArchiveMoney,
} from '@/schemas/manual-order-document-order';
import { isManualOrderDocumentContentValid } from '@/schemas/manual-order-document-order';

const RECEIPT_READY_STATUSES = new Set(['shipped', 'delivered']);

export function normalizePaymentStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
}

export function normalizeShippingStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
}

// A blank staff-entered source is absent, not imported: match the trigger
// and sender truthiness so the archive agrees with the queued email.
// Shared with the order-success resolver so both surfaces classify the
// same row the same way.
export function hasImportProvenance(input: {
  externalSource?: string | null;
  importJobId?: string | null;
}) {
  return Boolean(input.externalSource?.trim() || input.importJobId?.trim());
}

function isImportedHistoricalOrder(input: {
  externalSource?: string | null;
  importJobId?: string | null;
}) {
  return hasImportProvenance(input);
}

export function isManualOrder(input: {
  externalSource?: string | null;
  importJobId?: string | null;
  recordedByUserId?: string | null;
}) {
  return isManualOrderRecord(input);
}

interface ManualDocumentGatePaymentRow {
  amount?: unknown;
  status?: unknown;
  transaction_type?: unknown;
}

interface ManualDocumentGateTaxRow {
  vat_rate?: unknown;
  taxable_amount?: unknown;
  tax_amount?: unknown;
}

interface DocumentEligibilityInput {
  paymentStatus: string | null | undefined;
  shippingStatus: string | null | undefined;
  externalSource?: string | null;
  importJobId?: string | null;
  recordedByUserId?: string | null;
  total?: number | string | null;
  amountPaid?: number | string | null;
  money?: ManualDocumentArchiveMoney | null;
  items?: readonly ManualDocumentArchiveItem[] | null;
  payments?: readonly ManualDocumentGatePaymentRow[] | null;
  taxSubtotals?: readonly ManualDocumentGateTaxRow[] | null;
}

// Sender's settled-payment filter, mirrored exactly: the dispatch query
// matches transaction_type 'payment' with status completed/success, and
// every amount shares the sender's strict money predicate (nullish and
// blank fail closed, never coerce to zero).
function isSenderSettledPayment(row: ManualDocumentGatePaymentRow) {
  return (
    row.transaction_type === 'payment' &&
    (row.status === 'completed' || row.status === 'success')
  );
}

export function isManualOrderDocumentAvailable(
  input: DocumentEligibilityInput
) {
  // Mirror the sender's paid-balance consistency check: a paid order whose
  // total was corrected above its payments is skipped, never sent, so the
  // archive must not advertise a document for it.
  const paidBalanceSettled =
    normalizePaymentStatus(input.paymentStatus) !== 'paid' ||
    isSettledManualBalance({
      total: input.total,
      amountPaid: input.amountPaid,
    });
  // Child financial rows commit separately too: a settled payment or tax
  // subtotal the sender rejects must hide the document everywhere, not
  // just in the email. Payments gate every kind; tax gates invoices only,
  // mirroring the sender's !isPaid condition (paid label or covered
  // balance renders a receipt, which prints no tax breakdown). Callers
  // without child data pass nothing and keep the order/item verdict.
  const paymentsValid = (input.payments ?? [])
    .filter(isSenderSettledPayment)
    .every((row) => isNonNegativeMoney(row.amount));
  const invoiceKind =
    normalizePaymentStatus(input.paymentStatus) !== 'paid' &&
    !isSettledManualBalance({
      total: input.total,
      amountPaid: input.amountPaid,
    });
  const taxValid =
    !invoiceKind ||
    (input.taxSubtotals ?? []).every((row) =>
      [row.vat_rate, row.taxable_amount, row.tax_amount].every(
        isNonNegativeMoney
      )
    );
  return (
    isManualOrderRecord(input) &&
    !['cancelled', 'canceled', 'returned', 'failed'].includes(
      normalizeShippingStatus(input.shippingStatus)
    ) &&
    ['paid', 'unpaid', 'pending', 'partially_paid'].includes(
      normalizePaymentStatus(input.paymentStatus)
    ) &&
    paidBalanceSettled &&
    paymentsValid &&
    taxValid &&
    // Items commit separately from the order, and staff can save
    // database-permitted invalid values: validate the money breakdown and
    // per-item content through the sender's schemas so the archive never
    // advertises a document the sender terminally skips.
    isManualOrderDocumentContentValid(input.money, input.items)
  );
}

export function isReceiptEligible(input: DocumentEligibilityInput) {
  // A fully-covered manual order is substantively paid even under a non-paid
  // label (e.g. an over-amount partial): mirror the sender/trigger
  // normalization so the archive agrees with the emailed document.
  if (isManualOrderRecord(input)) {
    return (
      isManualOrderDocumentAvailable(input) &&
      isSettledManualBalance({
        total: input.total,
        amountPaid: input.amountPaid,
      })
    );
  }

  if (normalizePaymentStatus(input.paymentStatus) !== 'paid') {
    return false;
  }

  if (isImportedHistoricalOrder(input)) {
    return true;
  }

  return RECEIPT_READY_STATUSES.has(
    normalizeShippingStatus(input.shippingStatus)
  );
}

export function getCurrentDocumentKind(input: DocumentEligibilityInput) {
  return isReceiptEligible(input) ? 'receipt' : 'invoice';
}

// Manual-order flags for download gates and projections, derived from the
// same inputs as the document-kind derivation so every surface agrees.
export function manualDocumentAvailabilityFlags(
  input: DocumentEligibilityInput
) {
  return {
    isManualOrderRow: isManualOrder(input),
    manualDocumentAvailable: isManualOrderDocumentAvailable(input),
  };
}
