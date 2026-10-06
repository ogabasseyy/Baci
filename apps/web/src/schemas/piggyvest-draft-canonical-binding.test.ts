import { describe, expect, it } from 'vitest';
import { piggyvestDraftCanonicalBindingSchemas as schemas } from './piggyvest-draft-canonical-binding';

const identifier = 'a0000000-0000-4000-8000-000000000001';
const selection = {
  draftId: identifier,
  draftRevisionId: identifier,
  policyRevisionId: identifier,
};

describe('canonical draft binding schemas', () => {
  it('normalizes identifiers and accepts only a persisted binding receipt', () => {
    expect(
      schemas.selection.parse({
        ...selection,
        draftId: identifier.toUpperCase(),
      })
    ).toEqual(selection);
    expect(
      schemas.result.parse([
        {
          result: {
            ...selection,
            goalId: identifier,
            outcome: 'bound',
            boundAt: '2026-09-13T00:00:00Z',
          },
        },
      ])
    ).toHaveLength(1);
  });
  it.each([
    {},
    { ...selection, draftId: '' },
    { ...selection, consent: 'accepted' },
  ])('rejects incomplete or authoritative client fields: %j', (value) => {
    expect(schemas.selection.safeParse(value).success).toBe(false);
  });
  it.each([
    { value: [] },
    { value: [{ result: null }] },
    {
      value: [
        {
          result: {
            ...selection,
            goalId: identifier,
            outcome: 'bound',
            boundAt: 'yesterday',
          },
        },
      ],
    },
  ])('rejects missing or malformed durable receipts: %j', ({ value }) => {
    expect(schemas.result.safeParse(value).success).toBe(false);
  });
});
