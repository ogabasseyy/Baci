export class OrderStatusUpdateError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OrderStatusUpdateError';
  }
}
