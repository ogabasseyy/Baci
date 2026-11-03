import { describe, expect, it } from 'vitest';
import { isPiggyvestKilled } from './piggyvest-kill-switch';

describe('master kill switch', () => {
  it('is not killed when unset or explicitly false', () => {
    expect(isPiggyvestKilled({})).toBe(false);
    expect(isPiggyvestKilled({ PIGGYVEST_KILL_SWITCH: 'false' })).toBe(false);
  });
  it('is killed by true and fails closed on any other value', () => {
    for (const value of [
      'true',
      'TRUE',
      '1',
      'yes',
      ' false',
      'off',
      '',
      ' ',
    ]) {
      expect(isPiggyvestKilled({ PIGGYVEST_KILL_SWITCH: value })).toBe(true);
    }
  });
});
