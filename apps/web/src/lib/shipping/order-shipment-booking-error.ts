export class OrderShipmentBookingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly providerReference?: string,
    readonly details?: {
      availableBalance: number;
      chargedAmount: number;
      shortfall: number;
    }
  ) {
    super(message);
    this.name = 'OrderShipmentBookingError';
  }
}
