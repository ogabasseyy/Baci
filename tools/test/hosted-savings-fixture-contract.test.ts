import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsFixtureContract } from './hosted-savings-fixture-contract';

test('rejects absent reviewed identity and remote DSNs without coercion', () => {
  for (const input of [
    null,
    {},
    { databaseUrl: 'postgres://remote/db' },
    { systemIdentifier: 10 },
    { fixtureReviewed: false },
  ])
    assert.equal(hostedSavingsFixtureContract.safeParse(input).success, false);
});
