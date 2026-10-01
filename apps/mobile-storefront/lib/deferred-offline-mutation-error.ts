export class DeferredOfflineMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeferredOfflineMutationError';
  }
}
