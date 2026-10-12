import { expect, it } from 'vitest';
import { prefundedCardReplayReadinessSchema as schema } from './prefunded-card-replay-readiness';

it('requires exactly one true readiness result with no unexpected fields', () => {
  expect(schema.safeParse([{ result: true }]).success).toBe(true);
  for (const rows of [
    [],
    [{ result: false }],
    [{ result: 'true' }],
    [{ result: 1 }],
    [{ result: true }, { result: true }],
    [{ result: true, unexpected: 'secret' }],
    [{}],
    null,
    undefined,
  ]) {
    expect(schema.safeParse(rows).success).toBe(false);
  }
});
