// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseSurfaceStatus } from './agent-surface-status';

const COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

describe('parseSurfaceStatus', () => {
  it.each([
    ['unknown', { kind: 'unknown' }],
    ['not applicable', { kind: 'not_applicable' }],
    [
      'pass 2026-10-31 [test](../x.test.ts)',
      { kind: 'pass', date: '2026-10-31', evidence: '[test](../x.test.ts)' },
    ],
    [
      'fail 2026-10-30 abc1234',
      { kind: 'fail', date: '2026-10-30', evidence: 'abc1234' },
    ],
    [
      `pass 2024-02-29 ${COMMIT}`,
      { kind: 'pass', date: '2024-02-29', evidence: COMMIT },
    ],
  ])('parses %j', (cell, expected) => {
    expect(parseSurfaceStatus(cell)).toEqual(expected);
  });

  it('returns null for text that is not a status', () => {
    expect(parseSurfaceStatus('verified')).toBeNull();
  });
});
