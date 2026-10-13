import { expect, it } from 'vitest';
import { piggyvestCustomerClientRequestSchema as schema } from './piggyvest-customer-client-request';

const config = {
  mode: 'local_test',
  baseUrl: 'http://127.0.0.1:3000',
  endpointPaths: ['/purchase/quote'],
};
it('restricts origin, exact relative paths and credentials', () => {
  expect(schema.parse(config).credentials).toBe('omit');
  for (const patch of [
    { baseUrl: 'https://example.com' },
    { endpointPaths: [] },
    { endpointPaths: ['/../admin'] },
    { endpointPaths: ['/purchase?x=1'] },
    { credentials: 'ambient' },
  ])
    expect(schema.safeParse({ ...config, ...patch }).success).toBe(false);
});
