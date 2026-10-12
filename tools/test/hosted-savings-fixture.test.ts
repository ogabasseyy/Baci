import assert from 'node:assert/strict';
import test from 'node:test';
import { seedHostedSavingsFixture } from './hosted-savings-fixture';

test('invalid fixture input fails before opening a bundle or contacting Docker', async () => {
  await assert.rejects(
    seedHostedSavingsFixture(
      { databaseUrl: 'postgres://remote/db' },
      '/nonexistent-fixture-bundle'
    )
  );
});
