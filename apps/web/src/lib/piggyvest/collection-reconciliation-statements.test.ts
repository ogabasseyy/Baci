import { expect, it } from 'vitest';
import { COLLECTION_RECONCILIATION_STATEMENTS as statements } from './collection-reconciliation-statements';

it('exposes only metadata observe/read to the restricted local policy writer', () => {
  expect(Object.values(statements).map((entry) => entry.parameters)).toEqual([
    7, 8,
  ]);
  for (const entry of Object.values(statements)) {
    expect(entry.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(entry.text).not.toMatch(/apply|grant|insert|update/i);
  }
});
