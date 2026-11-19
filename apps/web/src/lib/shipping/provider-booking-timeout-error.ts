/** Thrown by the GIG clients when their own booking deadline passes. */
export class ProviderBookingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderBookingTimeoutError';
  }
}
