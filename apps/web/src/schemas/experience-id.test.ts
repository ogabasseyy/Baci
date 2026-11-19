import { expect, it } from 'vitest';
import { experienceId } from './experience-id';

it('accepts UUID identifiers and rejects arbitrary strings or nonstrings', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(experienceId.parse(id)).toBe(id);
  for (const value of ['opaque', ` ${id}`, { id }, null])
    expect(experienceId.safeParse(value).success).toBe(false);
});
