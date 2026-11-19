import { describe, expect, it } from '@jest/globals';
import { serverOffError } from '@/test-support/piggyvest-server-off.test-support';
import { primaryBalanceField } from './wallet-primary-balance';

describe('wallet primary balance with the server off', () => {
  it('adds no primary balance when the server answers not ready', () => {
    expect(serverOffError('PIGGYVEST_NOT_READY').code).toBe(
      'PIGGYVEST_NOT_READY'
    );
    expect(primaryBalanceField({ status: 'not_ready' })).toEqual({});
  });

  it('adds no primary balance for a pending snapshot or a failed probe', () => {
    expect(
      primaryBalanceField({ status: 'ready', account: null, balanceKobo: null })
    ).toEqual({});
    expect(primaryBalanceField({ status: 'unavailable' })).toEqual({});
  });
});
