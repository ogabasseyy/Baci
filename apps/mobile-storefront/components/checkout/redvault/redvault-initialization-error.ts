export class RedvaultInitializationError extends Error {
  constructor(readonly kind: 'definitive' | 'indeterminate') {
    super('Unable to initialize UBA payment');
  }
}
