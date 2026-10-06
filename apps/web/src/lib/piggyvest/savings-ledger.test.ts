import { describe, expect, it, vi } from 'vitest';
import { createSavingsLedger } from './savings-ledger';

vi.mock('server-only', () => ({}));
const identity = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
};
const command = {
  operationId: '50000000-0000-4000-8000-000000000001',
  kind: 'credit_principal',
  principalKobo: 100,
  interestKobo: 0,
  referenceId: null,
  evidenceId: 'synthetic-1',
};
describe('internal ledger adapter', () => {
  it('accepts PostgreSQL lowercase acknowledgement for uppercase UUID without changing replay commands', async () => {
    const uppercaseCommand = {
      ...command,
      operationId: 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF',
    };
    const acknowledgement = {
      operationId: uppercaseCommand.operationId.toLowerCase(),
      outcome: 'recorded',
    };
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: acknowledgement }],
    });
    const ledger = createSavingsLedger(identity, execute);

    await expect(ledger.apply(uppercaseCommand)).resolves.toEqual(
      acknowledgement
    );
    await expect(ledger.apply(uppercaseCommand)).resolves.toEqual(
      acknowledgement
    );

    expect(execute).toHaveBeenCalledTimes(2);
    for (const call of execute.mock.calls) {
      expect(JSON.parse(call[1][4])).toEqual(uppercaseCommand);
    }
    expect(execute.mock.calls[0][1][4]).toBe(execute.mock.calls[1][1][4]);
  });
  it('binds the configured identity in parameterized writes', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { result: { operationId: command.operationId, outcome: 'recorded' } },
      ],
    });
    const ledger = createSavingsLedger(identity, execute);
    await expect(ledger.apply(command)).resolves.toEqual({
      operationId: command.operationId,
      outcome: 'recorded',
    });
    expect(execute).toHaveBeenCalledWith(
      'SELECT piggyvest_savings_ledger.apply($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) AS result',
      [...Object.values(identity), expect.any(String)]
    );
    expect(JSON.parse(execute.mock.calls[0][1][4])).toEqual(command);
  });
  it('validates before executing and redacts storage failures', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('secret provider body'));
    const ledger = createSavingsLedger(identity, execute);
    await expect(
      ledger.apply({ ...command, principalKobo: 0.1 })
    ).rejects.toThrow('Internal savings ledger unavailable');
    expect(execute).not.toHaveBeenCalled();
    await expect(ledger.apply(command)).rejects.toThrow(
      'Internal savings ledger unavailable'
    );
  });
  it('rejects mismatched acknowledgement identities', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { operationId: identity.goalId, outcome: 'recorded' } }],
    });
    await expect(
      createSavingsLedger(identity, execute).apply(command)
    ).rejects.toThrow('Internal savings ledger unavailable');
  });
  it('rejects malformed read snapshots', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ result: { pendingInterestKobo: 100 } }] });
    await expect(
      createSavingsLedger(identity, execute).snapshot()
    ).rejects.toThrow('Internal savings ledger unavailable');
  });
  it('reads a validated snapshot with the bound identity', async () => {
    const snapshot = {
      ledger: {
        confirmedPrincipalKobo: 100,
        reservedPrincipalKobo: 0,
        paidEligibleInterestKobo: 10,
        reservedPaidInterestKobo: 0,
        pendingInterestKobo: 900,
      },
      activeReservation: null,
      fundingReversed: false,
    };
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: snapshot }] });
    await expect(
      createSavingsLedger(identity, execute).snapshot()
    ).resolves.toEqual(snapshot);
    expect(execute).toHaveBeenCalledWith(
      'SELECT piggyvest_savings_ledger.snapshot($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS result',
      Object.values(identity)
    );
  });
});
