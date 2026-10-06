import { expect, it } from 'vitest';
import { DEVICE_CHANGE_STATEMENTS } from './device-change-statements';

it('restricts exact seven-parameter device operations to the policy writer', () => {
  const operations = ['publish', 'confirm', 'read'];
  expect(Object.values(DEVICE_CHANGE_STATEMENTS)).toHaveLength(3);
  Object.values(DEVICE_CHANGE_STATEMENTS).forEach((statement, index) => {
    expect(statement.parameters).toBe(7);
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text).toBe(
      `SELECT piggyvest_device_change.${operations[index]}($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::${index === 2 ? 'uuid' : 'jsonb'}) AS result`
    );
  });
});
