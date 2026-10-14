import { cartBindingMatchesCurrentDevice } from './orders-cart-binding';

const ref = { merchantId: 'merchant-a', cartId: 'cart-a' };
const binding = {
  cart_id: 'cart-a',
  checkout_session_id: 'session',
  checkout_generation: 1,
  cart_version: 2,
};
it('refuses a legacy downgrade after the device acquired canonical cart ownership', () => {
  expect(cartBindingMatchesCurrentDevice(undefined, ref, 'merchant-a')).toBe(
    false
  );
  expect(cartBindingMatchesCurrentDevice(binding, ref, 'merchant-b')).toBe(
    false
  );
  expect(
    cartBindingMatchesCurrentDevice(
      { ...binding, cart_id: 'other' },
      ref,
      'merchant-a'
    )
  ).toBe(false);
  expect(cartBindingMatchesCurrentDevice(binding, ref, 'merchant-a')).toBe(
    true
  );
});
it('preserves ordinary guest legacy checkout when no canonical cart was acquired', () => {
  expect(
    cartBindingMatchesCurrentDevice(undefined, undefined, 'merchant-a')
  ).toBe(true);
});
