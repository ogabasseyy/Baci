export class MerchantRateAttestationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerchantRateAttestationInputError';
  }
}
