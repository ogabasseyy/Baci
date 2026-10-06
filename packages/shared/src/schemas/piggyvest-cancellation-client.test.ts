import { expect, it } from 'vitest';
import { piggyvestCancellationClientSchema as schema } from './piggyvest-cancellation-client';

const config = {
  mode: 'local_test',
  baseUrl: 'http://127.0.0.1:3000',
  endpointPath: '/local/cancel',
  recoveryEndpointPath: '/local/recovery',
};
it('requires distinct safe local paths and defaults credentials to omit', () => {
  expect(schema.parse(config).credentials).toBe('omit');
  for (const invalid of [
    { recoveryEndpointPath: config.endpointPath },
    { recoveryEndpointPath: `${config.endpointPath}/recovery` },
    { endpointPath: `${config.recoveryEndpointPath}/cancel` },
    { recoveryEndpointPath: '//evil.test' },
    { baseUrl: 'https://example.com' },
    { authorization: 'private' },
  ])
    expect(schema.safeParse({ ...config, ...invalid }).success).toBe(false);
});
