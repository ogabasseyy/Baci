interface PayAfterSaveInput {
  fetchPayment: () => Promise<Response>;
  log: (
    level: 'error',
    message: string,
    context: Record<string, unknown>
  ) => void;
  trackingId: string | undefined;
}

/**
 * Sends the pay-from-wallet request for a shipment Topship already saved.
 * A connection error here is NOT "never reached": the shipment exists, so it
 * throws a plain error (no network code) and the booking lock stays held
 * instead of allowing a duplicate shipment.
 */
export async function requestTopshipPaymentAfterSave({
  fetchPayment,
  log,
  trackingId,
}: PayAfterSaveInput): Promise<Response> {
  try {
    return await fetchPayment();
  } catch (error) {
    log('error', 'Topship payment request failed after save', {
      trackingId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Topship payment request failed after the shipment was saved (tracking ${trackingId ?? 'unknown'}).`
    );
  }
}
