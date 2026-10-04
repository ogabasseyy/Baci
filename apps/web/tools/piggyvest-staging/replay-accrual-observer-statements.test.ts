import { expect, it } from 'vitest';
import { PIGGYVEST_ACCRUAL_OBSERVER_STATEMENTS as statements } from './replay-accrual-observer-statements';

it('keeps all preflight statements read-only and mutation authority at one six-argument observation wrapper', () => {
  for (const query of [
    statements.session,
    statements.identity,
    statements.authority,
  ]) {
    expect(query.replace(/'(?:[^']|'')*'/g, '')).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|GRANT|ALTER|CREATE|CALL)\b/
    );
    expect(query).not.toContain(
      'SELECT piggyvest_staging.record_interest_accrual('
    );
  }
  expect(statements.apply).toBe(
    'SELECT piggyvest_staging.record_interest_accrual_scoped($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::json) AS result'
  );
  expect(statements.authority).toContain('pg_get_functiondef(original.oid)');
  expect(statements.authority).toContain('pg_get_functiondef(wrapper.oid)');
  expect(statements.authority).toContain('has_table_privilege');
});

it('refuses column-only financial write grants as well as table write grants', () => {
  expect(statements.authority).toContain('has_any_column_privilege');
});
