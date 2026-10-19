export class LocalAirportDeliveryFeeMismatchError extends Error {
  readonly code = 'SHIPPING_FEE_MISMATCH';
  readonly status = 400;

  constructor(
    readonly clientShippingFee: number,
    readonly serverShippingFee: number
  ) {
    super('Shipping fee does not match the selected local airport fee');
    this.name = 'LocalAirportDeliveryFeeMismatchError';
  }
}
