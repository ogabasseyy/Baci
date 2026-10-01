export class OrderQuoteDestinationMismatchError extends Error {
  constructor(
    message = 'The saved shipping quote no longer matches this delivery address. Please get a new quote before checkout.',
    readonly code = 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
    readonly status = 400
  ) {
    super(message);
    this.name = 'OrderQuoteDestinationMismatchError';
  }
}
