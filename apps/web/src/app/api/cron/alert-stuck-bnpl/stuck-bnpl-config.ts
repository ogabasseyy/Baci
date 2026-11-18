export const STUCK_BNPL_CONFIG = {
  minAgeHours: 24,
  maxAgeDays: 7,
  notificationConcurrency: 5,
  orderScanLimit: 500,
  transactionLookupBatchSize: 50,
  paymentMethods: ['credit_direct', 'klump', 'credpal'],
  // Covers opened sessions, partial webhook delivery, and BNPL flows that do
  // not flip into a dedicated provider status before confirmation.
  paymentStatuses: ['bnpl_pending', 'bnpl_approved', 'pending', 'unpaid'],
};
