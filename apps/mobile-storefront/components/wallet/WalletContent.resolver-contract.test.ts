import type { WalletContentProps } from './WalletContent';

it('requires a real resolver callback at every typed wallet call site', () => {
  const resolverIsRequired: undefined extends WalletContentProps['onResolveSavingsVariant']
    ? false
    : true = true;
  expect(resolverIsRequired).toBe(true);
});
