import { oxygenLinkedCustomerPrefill } from './customer-prefill';

const owner = {
  userId: 'user',
  customerId: 'customer',
  merchantId: 'merchant',
};
const customer = {
  id: 'customer',
  user_id: 'user',
  merchant_id: 'merchant',
  first_name: 'Saved',
  last_name: 'Customer',
  email: 'saved@example.invalid',
  date_of_birth: '1990-01-02',
};

it('uses linked profile names when order persistence omitted separate names, preserving checkout edits', () => {
  expect(
    oxygenLinkedCustomerPrefill(customer, owner, {
      email: 'checkout@example.invalid',
    })
  ).toEqual({
    first_name: 'Saved',
    last_name: 'Customer',
    email: 'checkout@example.invalid',
    date_of_birth: '1990-01-02',
  });
});

it.each([
  { user_id: 'other' },
  { merchant_id: 'other' },
  { id: 'other' },
])('never copies a mismatched profile %j', (mismatch) => {
  expect(
    oxygenLinkedCustomerPrefill({ ...customer, ...mismatch }, owner, {})
  ).toEqual({});
});
