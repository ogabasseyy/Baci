export const redvaultCaptureCases = [
  {
    kind: 'captured_held',
    code: 'REDVAULT_CAPTURE_HELD',
    error: 'Payment capture is pending eligibility confirmation',
  },
  {
    kind: 'capture_evidence_review',
    code: 'REDVAULT_CAPTURE_EVIDENCE_REVIEW',
    error: 'Payment capture evidence requires review',
  },
].flatMap((outcome) =>
  ['pending', 'completed'].map((transactionStatus) => ({
    ...outcome,
    transactionStatus,
  }))
);
