import { parseProviderContract } from './parse-provider-contract';

it('rejects an incomplete contract', () => {
  expect(() => parseProviderContract({})).toThrow('Invalid provider contract');
});
