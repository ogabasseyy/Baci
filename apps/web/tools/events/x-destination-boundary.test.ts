import { readFileSync } from 'node:fs';
import { URL as FileURL, fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { analyzeRpcSource } from './verify-event-pipeline-boundaries';

const adapter = 'apps/web/src/lib/events/x-destination-adapter.ts';
it('limits X worker reads to the exact declared projections', () => {
  expect(
    analyzeRpcSource(
      adapter,
      readFileSync(
        fileURLToPath(new FileURL(`../../../../${adapter}`, import.meta.url)),
        'utf8'
      )
    )
  ).toEqual([]);
});
it('does not grant another worker saved OAuth secret access', () => {
  const path = 'apps/web/src/lib/events/unrelated-worker.ts';
  expect(
    analyzeRpcSource(
      path,
      "client.from('merchant_x_ads_credentials').select('consumer_secret')"
    )
  ).toContain(
    `${path}: unauthorized merchant_x_ads_credentials column consumer_secret`
  );
});
it('does not grant the X adapter unrelated merchant credentials or writes', () => {
  expect(
    analyzeRpcSource(
      adapter,
      "client.from('merchants').select('facebook_capi_token')"
    )
  ).toContain(`${adapter}: unauthorized merchants column facebook_capi_token`);
  expect(
    analyzeRpcSource(
      adapter,
      "client.from('merchant_x_ads_credentials').update({consumer_secret:'bad'})"
    )
  ).toContain(`${adapter}: unauthorized update on merchant_x_ads_credentials`);
});
