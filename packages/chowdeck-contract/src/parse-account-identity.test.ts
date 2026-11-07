import { parseAccountIdentity } from './parse-account-identity';

it('enforces the observation contract', () => {
  expect(() =>
    parseAccountIdentity({ currency: 'NGN', domain: 'shop.test' })
  ).toThrow('Invalid account identity');
});
