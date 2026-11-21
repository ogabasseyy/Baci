// Keep accepted refund IDs on the failed attempt for reconciliation. The
// retry still reads authoritative payment/refund rows before sending anything.
export class PartialCancellationRefundError extends Error {
  constructor(public readonly refundIds: number[]) {
    super('Unable to verify bank card offer refund capture');
  }
}
