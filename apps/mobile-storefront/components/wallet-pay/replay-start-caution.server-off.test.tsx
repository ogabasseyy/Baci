import { describe, expect, it } from '@jest/globals';
import { startWithReplayCaution } from './replay-start-caution';

const outcome = (kind: string) =>
  ({ kind: 'outcome', outcome: { kind } }) as never;

describe('startWithReplayCaution', () => {
  it('leaves a new purchase answer as it is', async () => {
    await expect(
      startWithReplayCaution(false, async () => outcome('unavailable'))
    ).resolves.toEqual({ kind: 'outcome', outcome: { kind: 'unavailable' } });
  });

  it('bugfix: marks an ambiguous replayed start as possibly paid (Codex P2)', async () => {
    for (const kind of ['sign_in', 'unavailable', 'not_started'])
      await expect(
        startWithReplayCaution(true, async () => outcome(kind))
      ).resolves.toEqual({
        kind: 'outcome',
        outcome: { kind, maybePaid: true },
      });
  });

  it('keeps a definite replayed answer (refunded, delivered) as it is', async () => {
    await expect(
      startWithReplayCaution(true, async () => outcome('refunded'))
    ).resolves.toEqual({ kind: 'outcome', outcome: { kind: 'refunded' } });
  });

  it('turns a throw on a replay into a possibly-paid try again', async () => {
    await expect(
      startWithReplayCaution(true, async () => {
        throw new Error('network');
      })
    ).resolves.toEqual({
      kind: 'outcome',
      outcome: { kind: 'not_started', maybePaid: true },
    });
    await expect(
      startWithReplayCaution(false, async () => {
        throw new Error('network');
      })
    ).rejects.toThrow('network');
  });
});
