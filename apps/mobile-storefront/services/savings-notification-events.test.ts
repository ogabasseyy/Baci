import { savingsNotificationEvents } from './savings-notification-events';

it('refreshes only the matching customer and merchant and removes subscriptions', () => {
  const refresh = jest.fn();
  const unsubscribe = savingsNotificationEvents.subscribe(
    { merchantId: 'merchant', userId: 'customer' },
    refresh
  );
  savingsNotificationEvents.publish({
    merchantId: 'other',
    userId: 'customer',
  });
  savingsNotificationEvents.publish({
    merchantId: 'merchant',
    userId: 'other',
  });
  expect(refresh).not.toHaveBeenCalled();
  savingsNotificationEvents.publish({
    merchantId: 'merchant',
    userId: 'customer',
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  unsubscribe();
  savingsNotificationEvents.publish({
    merchantId: 'merchant',
    userId: 'customer',
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});
