import { describe, expect, it } from 'vitest';
import { DRAFT_CANONICAL_BINDING_STATEMENTS } from './draft-canonical-binding-statements';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';

describe('draft binding pending executor registration', () => {
  it('offers one parameterized writer statement without activating the shared executor', () => {
    const statement = DRAFT_CANONICAL_BINDING_STATEMENTS.bindCanonicalDraft;
    expect(statement.parameters).toBe(9);
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text).toBe(
      'SELECT savings_draft_private.bind_canonical($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::uuid,$9::uuid) AS result'
    );
    expect(
      Object.values(PIGGYVEST_POSTGRES_STATEMENTS).map((entry) => entry.text)
    ).not.toContain(statement.text);
  });
});
