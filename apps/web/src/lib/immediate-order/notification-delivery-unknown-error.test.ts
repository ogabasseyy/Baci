import { expect, it } from 'vitest';
import { ImmediateNotificationDeliveryUnknownError } from './notification-delivery-unknown-error';

it('marks an uncertain provider outcome with a distinct Error identity', () => {
  const error = new ImmediateNotificationDeliveryUnknownError();
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(ImmediateNotificationDeliveryUnknownError);
  expect(error.name).toBe('ImmediateNotificationDeliveryUnknownError');
  expect(error.message).toBe('ORDER_CONFIRMATION_DELIVERY_UNKNOWN');
});
