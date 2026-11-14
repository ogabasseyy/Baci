import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  type ContributionRail,
  getErrorCode,
  resolveStoredOperation,
} from './stored-contribution-operation';

const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheckStatus(...args),
}));

const run = (operationId: string | null, rail: ContributionRail | null) =>
  resolveStoredOperation({ merchantId: 'm1', operationId, rail });

describe('resolveStoredOperation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mints fresh without a stored id', async () => {
    expect(await run(null, null)).toEqual({
      operationId: null,
      rail: null,
      confirmed: false,
    });
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('keeps a legacy-rail id without any primary call', async () => {
    expect(await run('op', 'legacy')).toEqual({
      operationId: 'op',
      rail: 'legacy',
      confirmed: false,
    });
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', false],
    ['confirmed', true],
  ])('never sends an unrecorded id to legacy while primary reports %s', async (status, confirmed) => {
    mockCheckStatus.mockResolvedValue({ status });
    expect(await run('op', null)).toEqual({
      operationId: 'op',
      rail: 'primary',
      confirmed,
    });
  });

  it('resubmits an unrecorded id on legacy, same id, when primary has no record', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    expect(await run('op', null)).toEqual({
      operationId: 'op',
      rail: 'legacy',
      confirmed: false,
    });
  });

  it('SAVINGS_MERCHANT_NOT_PRIMARY: unrecorded goes to legacy, recorded primary is kept as unknown', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'SAVINGS_MERCHANT_NOT_PRIMARY' })
    );
    expect(await run('op', null)).toEqual({
      operationId: 'op',
      rail: 'legacy',
      confirmed: false,
    });
    expect(await run('op', 'primary')).toEqual({
      operationId: 'op',
      rail: 'primary',
      confirmed: false,
      unknown: true,
    });
  });

  it('keeps SAVINGS_NOT_READY ambiguous: the runtime may be off', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'SAVINGS_NOT_READY' })
    );
    expect(await run('op', null)).toMatchObject({ unknown: true });
  });

  it('blocks an unrecorded id on an ambiguous status error', async () => {
    mockCheckStatus.mockRejectedValue(new Error('network'));
    expect(await run('op', null)).toEqual({
      operationId: 'op',
      rail: 'primary',
      confirmed: false,
      unknown: true,
    });
  });

  it('keeps a pending primary id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'pending' });
    expect(await run('op', 'primary')).toEqual({
      operationId: 'op',
      rail: 'primary',
      confirmed: false,
    });
  });

  it('flags a confirmed primary id so it is not submitted again', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'confirmed' });
    expect(await run('op', 'primary')).toEqual({
      operationId: 'op',
      rail: 'primary',
      confirmed: true,
    });
  });

  it('releases a cancelled primary id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'cancelled' });
    expect(await run('op', 'primary')).toEqual({
      operationId: null,
      rail: null,
      confirmed: false,
    });
  });

  it('releases a primary id that primary has no record of', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    expect(await run('op', 'primary')).toEqual({
      operationId: null,
      rail: null,
      confirmed: false,
    });
  });

  it('blocks on an ambiguous primary status error and keeps the id', async () => {
    mockCheckStatus.mockRejectedValue(new Error('network'));
    expect(await run('op', 'primary')).toEqual({
      operationId: 'op',
      rail: 'primary',
      confirmed: false,
      unknown: true,
    });
  });
});

describe('getErrorCode', () => {
  it('reads string codes only', () => {
    expect(getErrorCode({ code: 'A' })).toBe('A');
    expect(getErrorCode({ code: 1 })).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});
