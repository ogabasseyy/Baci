export interface FailedManualDocumentSendResult {
  success: boolean;
  error?: string;
  deliveryOutcome?: 'unknown';
}

export type FailedManualDocumentSendOutcome =
  | { status: 'failed'; error: string }
  | { status: 'failed'; error: string; deliveryOutcome: 'unknown' };

export async function reportFailedManualDocumentSend(
  result: FailedManualDocumentSendResult,
  clearDispatchMarker: () => Promise<void>
): Promise<FailedManualDocumentSendOutcome> {
  // A definite rejection never reached the customer: clear the marker so
  // the bounded retry re-claims cleanly. Unknown outcomes keep the marker.
  if (result.deliveryOutcome !== 'unknown') {
    // Inline clear retries + worker reclaim precede the next claim, so retries re-send.
    try {
      await clearDispatchMarker();
    } catch {
      return { status: 'failed', error: 'dispatch_marker_clear_failed' };
    }
  }
  return {
    status: 'failed',
    error: result.error || 'Document email failed',
    ...(result.deliveryOutcome === 'unknown'
      ? { deliveryOutcome: 'unknown' as const }
      : {}),
  };
}
