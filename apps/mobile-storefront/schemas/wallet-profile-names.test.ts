import { WalletProfileNamesSchema } from './wallet-profile-names';

it('rejects a full name exceeding the provider identity limit', () => {
  expect(
    WalletProfileNamesSchema.safeParse({
      first_name: 'a'.repeat(100),
      last_name: 'b'.repeat(100),
    }).success
  ).toBe(false);
});

it('trims valid names', () => {
  expect(
    WalletProfileNamesSchema.parse({
      first_name: ' Ada ',
      last_name: ' Okafor ',
    })
  ).toEqual({ first_name: 'Ada', last_name: 'Okafor' });
});
it.each([
  '',
  ' ',
  'a'.repeat(101),
])('rejects an invalid required name', (first_name) => {
  expect(
    WalletProfileNamesSchema.safeParse({ first_name, last_name: 'Okafor' })
      .success
  ).toBe(false);
});
