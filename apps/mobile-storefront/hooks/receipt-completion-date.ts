// Re-exported from the shared receipt package so mobile and web date
// receipts identically (single settled-payment max-pick rule). Null
// entries fail closed here, never crash the render.
export { selectReceiptCompletionDate } from '@baci/shared/receipt';
