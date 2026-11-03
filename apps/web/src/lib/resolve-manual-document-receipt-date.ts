// Re-exported from the shared receipt package so web and mobile date
// receipts identically (single settled-payment max-pick rule).
export {
  type ReceiptCompletionCandidate,
  selectReceiptCompletionDate,
} from '@baci/shared/receipt';
