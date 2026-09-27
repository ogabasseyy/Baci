export class NegotiationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NegotiationValidationError';
  }
}
