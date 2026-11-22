import { oxygenIdentityErrors } from './oxygen-identity-validation';

const fields = {
  first_name: 'Test',
  last_name: 'Customer',
  email: 'test@example.invalid',
  bvn: '12345678901',
  nin: '12345678901',
  date_of_birth: '1990-01-01',
};
it('identifies the exact incomplete BVN without exposing its value', () => {
  expect(
    oxygenIdentityErrors({ ...fields, bvn: '1234567890' }, '08012345678')
  ).toEqual({ bvn: 'Enter your complete 11-digit BVN.' });
});
it('accepts complete identity details', () => {
  expect(oxygenIdentityErrors(fields, '08012345678')).toEqual({});
});
