import { describe, expect, it } from '@jest/globals';
import { describeSetupError } from './describe-setup-error';

describe('savings wallet setup errors with the server keeping PiggyVest off', () => {
  it('says setup is unavailable when PiggyVest is off', () => {
    expect(describeSetupError({ code: 'PIGGYVEST_NOT_READY' })).toEqual({
      field: 'form',
      message: 'Wallet setup is unavailable right now. Please try again later.',
      clearBvn: false,
    });
  });

  it('puts a rejected BVN under the field and drops the number', () => {
    expect(describeSetupError({ code: 'INVALID_BVN' })).toMatchObject({
      field: 'bvn',
      clearBvn: true,
    });
  });

  it('never shows provider text for an unknown failure', () => {
    const outcome = describeSetupError(new Error('private provider error'));
    expect(outcome.field).toBe('form');
    expect(outcome.message).not.toContain('private');
  });
});
