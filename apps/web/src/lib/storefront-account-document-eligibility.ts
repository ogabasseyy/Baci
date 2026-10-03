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

function isImportedHistoricalOrder(input: {
  externalSource?: string | null;
  importJobId?: string | null;
}) {
  // A blank staff-entered source is absent, not imported: match the trigger
  // and sender truthiness so the archive agrees with the queued email.
  return Boolean(input.externalSource?.trim() || input.importJobId);
}

export function isManualOrder(input: {
  externalSource?: string | null;
  importJobId?: string | null;
  recordedByUserId?: string | null;
}) {
  return Boolean(input.recordedByUserId) && !isImportedHistoricalOrder(input);
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
}

export function isManualOrderDocumentAvailable(
  input: DocumentEligibilityInput
) {
  // Mirror the sender's paid-balance consistency check: a paid order whose
  // total was corrected above its payments is skipped, never sent, so the
  // archive must not advertise a document for it.
  const paidBalanceSettled =
    normalizePaymentStatus(input.paymentStatus) !== 'paid' ||
    (input.total != null &&
      input.amountPaid != null &&
      Number.isFinite(Number(input.total)) &&
      Number(input.total) >= 0 &&
      Number.isFinite(Number(input.amountPaid)) &&
      Number(input.amountPaid) >= Number(input.total));
  return (
    Boolean(input.recordedByUserId) &&
    !isImportedHistoricalOrder(input) &&
    !['cancelled', 'canceled', 'returned', 'failed'].includes(
      normalizeShippingStatus(input.shippingStatus)
    ) &&
    ['paid', 'unpaid', 'pending', 'partially_paid'].includes(
      normalizePaymentStatus(input.paymentStatus)
    ) &&
    paidBalanceSettled &&
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
  if (input.recordedByUserId && !isImportedHistoricalOrder(input)) {
    return (
      isManualOrderDocumentAvailable(input) &&
      input.total != null &&
      input.amountPaid != null &&
      Number.isFinite(Number(input.total)) &&
      Number(input.total) >= 0 &&
      Number.isFinite(Number(input.amountPaid)) &&
      Number(input.amountPaid) >= Number(input.total)
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
