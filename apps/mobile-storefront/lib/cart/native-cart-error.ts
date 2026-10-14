export class NativeCartError extends Error {
  constructor(
    readonly code: string,
    readonly indeterminate = false
  ) {
    super('Cart request unavailable');
    this.name = 'NativeCartError';
  }
}
