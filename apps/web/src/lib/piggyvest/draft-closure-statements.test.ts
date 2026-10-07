import { expect, it } from 'vitest';
import { DRAFT_CLOSURE_STATEMENTS as statements } from './draft-closure-statements';

it('limits closure statements to the exact read and close RPCs and policy writer', () => {
  expect(Object.keys(statements)).toEqual([
    'readDraftClosure',
    'closeUnfundedDraft',
  ]);
  expect(statements.readDraftClosure.parameters).toBe(6);
  expect(statements.closeUnfundedDraft.parameters).toBe(7);
  for (const statement of Object.values(statements)) {
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text).toMatch(
      /^SELECT piggyvest_draft_closure\.(read|close)\(/
    );
  }
});
