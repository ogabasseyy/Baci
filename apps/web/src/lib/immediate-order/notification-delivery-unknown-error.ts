/** The provider may have accepted the message; a retry cannot be assumed safe. */
export class ImmediateNotificationDeliveryUnknownError extends Error {
  constructor() {
    super('ORDER_CONFIRMATION_DELIVERY_UNKNOWN');
    this.name = 'ImmediateNotificationDeliveryUnknownError';
  }
}
