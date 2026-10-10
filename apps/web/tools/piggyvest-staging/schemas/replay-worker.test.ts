import { expect, it } from 'vitest';
import { replayWorkerSchemas } from './replay-worker';

it('requires staging and a bounded receipt batch', () => {
  expect(
    replayWorkerSchemas.configuration.safeParse({
      environment: 'staging',
      batchSize: 10,
    }).success
  ).toBe(true);
  expect(
    replayWorkerSchemas.configuration.safeParse({
      environment: 'production',
      batchSize: 10,
    }).success
  ).toBe(false);
  expect(
    replayWorkerSchemas.configuration.safeParse({
      environment: 'staging',
      batchSize: 101,
    }).success
  ).toBe(false);
});
it('requires complete exact mapping identities', () => {
  expect(
    replayWorkerSchemas.mapping.safeParse({ status: 'unmapped' }).success
  ).toBe(true);
  expect(
    replayWorkerSchemas.mapping.safeParse({
      status: 'matched',
      mapping: { merchantId: 'merchant' },
    }).success
  ).toBe(false);
  expect(
    replayWorkerSchemas.mapping.safeParse({ status: 'ambiguous', mapping: {} })
      .success
  ).toBe(false);
});
