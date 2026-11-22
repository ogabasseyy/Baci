import { oxygenOrderPrefill } from './order-prefill';

it('reuses explicit checkout names and email without copying a pickup destination into home fields', () => {
  expect(
    oxygenOrderPrefill({
      customer_email: 'edited@example.invalid',
      shipping_address: {
        firstName: 'Checkout',
        lastName: 'Customer',
        address: 'Merchant pickup office',
      },
    })
  ).toEqual({
    first_name: 'Checkout',
    last_name: 'Customer',
    email: 'edited@example.invalid',
  });
});

it('treats legacy or malformed contact values as absent', () => {
  expect(
    oxygenOrderPrefill({ customer_email: null, shipping_address: 'legacy' })
  ).toEqual({});
});

it('suggests an editable checkout address only for explicit home delivery', () => {
  const shipping_address = {
    address: 'Example Street',
    state: 'Lagos',
    city: 'Ikeja',
  };
  expect(
    oxygenOrderPrefill({ delivery_method: 'door', shipping_address })
  ).toEqual({
    home_street: 'Example Street',
    home_state: 'Lagos',
    home_city: 'Ikeja',
  });
  expect(
    oxygenOrderPrefill({ delivery_method: 'pickup', shipping_address })
  ).toEqual({});
  expect(oxygenOrderPrefill({ shipping_address })).toEqual({});
});

it.each([
  'firstName',
  'lastName',
  'email',
])('never truncates overlong checkout %s into a different identity', (key) => {
  const read = (value: string) =>
    oxygenOrderPrefill(
      key === 'email'
        ? { customer_email: value }
        : { shipping_address: { [key]: value } }
    );
  expect(Object.values(read('a'.repeat(100)))).toEqual(['a'.repeat(100)]);
  expect(read('a'.repeat(101))).toEqual({});
});
