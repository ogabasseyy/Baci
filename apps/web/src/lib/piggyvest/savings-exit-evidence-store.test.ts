import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVINGS_EXIT_EVIDENCE_STATEMENTS as statements } from './savings-exit-evidence-statements';
import { createSavingsExitEvidenceStore } from './savings-exit-evidence-store';

const database = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    connect = database.connect;
    query = database.query;
    end = database.end;
    on = database.on;
  },
}));
const configuration = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  socketDirectory: '/private/tmp/baci-savings-exit-accounting.synthetic/socket',
  port: 55454,
};
const receipt = {
  eventId: 'event',
  providerTransactionId: 'transaction',
  providerCustomerId: 'customer',
  reference: '30000000-0000-4000-8000-000000004212',
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  businessId: 'business',
  currency: 'NGN',
  amountKobo: 100,
  feeKobo: 0,
  payloadSha256: 'a'.repeat(64),
};
beforeEach(() => {
  vi.clearAllMocks();
  database.connect.mockResolvedValue(undefined);
  database.end.mockResolvedValue(undefined);
  database.query.mockResolvedValue({ rows: [{ result: { state: 'stored' } }] });
});
describe('restricted local evidence recorder', () => {
  it('commits provider evidence before acknowledging storage', async () => {
    const execute = createSavingsExitEvidenceStore(configuration);
    expect(
      await execute(statements.exitRecordEvidence.text, [
        configuration.integrationId,
        JSON.stringify(receipt),
      ])
    ).toEqual({ rows: [{ result: { state: 'stored' } }] });
    expect(database.query.mock.calls.map(([query]) => query)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      statements.exitRecordEvidence.text,
      'COMMIT',
    ]);
    expect(database.end).toHaveBeenCalledOnce();
  });
  it('never accepts a remote database, caller role, or arbitrary statement', async () => {
    expect(() =>
      createSavingsExitEvidenceStore({
        ...configuration,
        socketDirectory: 'production.example',
      })
    ).toThrow();
    expect(() =>
      createSavingsExitEvidenceStore({ ...configuration, role: 'service_role' })
    ).toThrow();
    const execute = createSavingsExitEvidenceStore(configuration);
    await expect(execute('SELECT forbidden()', [])).rejects.toThrow('denied');
    await expect(
      execute(statements.exitRecordEvidence.text, [
        'other',
        JSON.stringify(receipt),
      ])
    ).rejects.toThrow('denied');
    expect(database.connect).not.toHaveBeenCalled();
  });
  it('does not acknowledge an uncertain commit and always closes the connection', async () => {
    database.query.mockImplementation(async (query: string) => {
      if (query === 'COMMIT') throw new Error('synthetic connection loss');
      return { rows: [{ result: { state: 'stored' } }] };
    });
    const execute = createSavingsExitEvidenceStore(configuration);
    await expect(
      execute(statements.exitRecordEvidence.text, [
        configuration.integrationId,
        JSON.stringify(receipt),
      ])
    ).rejects.toThrow('storage unavailable');
    expect(database.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(database.end).toHaveBeenCalledOnce();
  });
});
