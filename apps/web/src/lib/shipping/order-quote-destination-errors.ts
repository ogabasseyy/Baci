export class OrderQuoteDestinationMismatchError extends Error {
  static forFields(fields: readonly string[]) {
    return new OrderQuoteDestinationMismatchError(
      undefined,
      undefined,
      undefined,
      fields
    );
  }

  constructor(
    message = 'The saved shipping quote no longer matches this delivery address. Please get a new quote before checkout.',
    readonly code = 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
    readonly status = 400,
    readonly mismatchFields: readonly string[] = []
  ) {
    super(message);
    this.name = 'OrderQuoteDestinationMismatchError';
  }
}
