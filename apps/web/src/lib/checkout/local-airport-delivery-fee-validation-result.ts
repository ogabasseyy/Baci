export interface LocalAirportDeliveryFeeValidationResult {
  isIdempotentLocalAirportReplay: boolean;
  /** Existing keyed checkout replay whose quote may no longer be available. */
  isIdempotentOrderReplay?: boolean;
  localAirportShippingFee: number | null;
  resolvedDeliveryMethod?: 'airport';
  resolvedAirportType?: 'delivery' | 'pickup';
}
