import { beforeEach, describe, expect, it, vi } from 'vitest';

const pg = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      pg.construct(config);
    }
    query = pg.query;
    connect = pg.connect;
    end = pg.end;
    on = pg.on;
  },
}));

import { PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS } from './transfer-outbox-submission-statements';
import { createTransferSubmissionPostgres } from './transfer-submission-postgres';

const config = {
  host: 'baci-isolated-savings-db-1',
  port: 5432,
  database: 'postgres',
  role: 'piggyvest_staging_submission_writer',
  transport: 'private-internal',
  password: 'synthetic-password',
  expectedSystemId: '9876543210',
  businessId: 'business-001',
  integrationId: 'integration-001',
};
const statement = PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim;
const parameters = [
  '9876543210',
  'a0065070-dc32-45d2-9c01-871a27abfd10',
  'submission-001',
  'c0065070-dc32-45d2-9c01-871a27abfd10',
  '43e157b6-179c-432a-9392-e0827da96d82',
  'ledger-wallet-001',
  500_000,
  'NGN',
  'source-wallet-001',
  '058:6789',
  'bank',
  'provider-customer-001',
  'business-001',
  'integration-001',
];

beforeEach(() => {
  vi.clearAllMocks();
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockImplementation(async (query: string) =>
    query.startsWith('SELECT session_user')
      ? {
          rows: [
            {
              login: config.role,
              role: config.role,
              database: config.database,
            },
          ],
        }
      : query === 'COMMIT'
        ? { command: 'COMMIT' }
        : { rows: [{ outcome: 'claimed' }] }
  );
});

describe('restricted transfer submission Postgres executor', () => {
  it('commits the exact allowlisted statement before acknowledging rows', async () => {
    await expect(
      createTransferSubmissionPostgres(config)(statement.text, parameters)
    ).resolves.toEqual({ rows: [{ outcome: 'claimed' }] });
    expect(pg.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(pg.construct).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: false })
    );
    expect(pg.end).toHaveBeenCalledOnce();
  });

  it('accepts each exact submission statement with its declared parameter count', async () => {
    const execute = createTransferSubmissionPostgres(config);
    for (const candidate of Object.values(
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS
    )) {
      const candidateParameters =
        candidate.parameters === 16
          ? [...parameters, 'provider-transaction-001', 'succeeded']
          : parameters;
      await expect(
        execute(candidate.text, candidateParameters)
      ).resolves.toEqual({ rows: [{ outcome: 'claimed' }] });
      expect(candidateParameters).toHaveLength(candidate.parameters);
    }
    expect(pg.connect).toHaveBeenCalledTimes(4);
    expect(
      pg.query.mock.calls.filter(([query]) => query === 'COMMIT')
    ).toHaveLength(4);
  });

  it('rejects arbitrary SQL before connecting', async () => {
    await expect(
      createTransferSubmissionPostgres(config)('DELETE FROM customers', [])
    ).rejects.toThrow('Transfer submission database unavailable');
    expect(pg.connect).not.toHaveBeenCalled();
  });

  it.each(
    [
      parameters.slice(0, 13),
      [...parameters.slice(0, 13), {}],
      [...parameters.slice(0, 13), Number.MAX_SAFE_INTEGER + 1],
      parameters.map((value, index) => (index === 1 ? 'invalid-uuid' : value)),
      parameters.map((value, index) => (index === 7 ? 'USD' : value)),
    ].map((input) => [input] as const)
  )('rejects malformed allowlisted parameters before connecting %#', async (input) => {
    await expect(
      createTransferSubmissionPostgres(config)(statement.text, input)
    ).rejects.toThrow('Transfer submission database unavailable');
    expect(pg.connect).not.toHaveBeenCalled();
    expect(pg.construct).not.toHaveBeenCalled();
  });

  it.each(
    [
      parameters.map((value, index) => (index === 0 ? '1234567890' : value)),
      parameters.map((value, index) =>
        index === 12 ? 'other-business' : value
      ),
      parameters.map((value, index) =>
        index === 13 ? 'other-integration' : value
      ),
    ].map((input) => [input] as const)
  )('rejects a mismatched target or scope before connecting %#', async (input) => {
    await expect(
      createTransferSubmissionPostgres(config)(statement.text, input)
    ).rejects.toThrow('Transfer submission database unavailable');
    expect(pg.connect).not.toHaveBeenCalled();
    expect(pg.construct).not.toHaveBeenCalled();
  });

  it('rejects a different database login and rolls back', async () => {
    pg.query.mockResolvedValue({
      rows: [{ login: 'postgres', role: 'postgres', database: 'postgres' }],
    });
    await expect(
      createTransferSubmissionPostgres(config)(statement.text, parameters)
    ).rejects.toThrow('Transfer submission database unavailable');
    expect(pg.query).not.toHaveBeenCalledWith(
      statement.text,
      expect.anything()
    );
    expect(pg.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not acknowledge an unconfirmed commit or disclose its error', async () => {
    pg.query.mockImplementation(async (query: string) => {
      if (query === 'COMMIT') throw new Error('password=secret');
      return query.startsWith('SELECT session_user')
        ? {
            rows: [
              {
                login: config.role,
                role: config.role,
                database: config.database,
              },
            ],
          }
        : { rows: [{ outcome: 'claimed' }] };
    });
    await expect(
      createTransferSubmissionPostgres(config)(statement.text, parameters)
    ).rejects.toThrow('Transfer submission database unavailable');
    expect(pg.end).toHaveBeenCalledOnce();
  });

  it('refuses unpinned staging configuration before constructing a client', () => {
    expect(() =>
      createTransferSubmissionPostgres({
        ...config,
        host: 'production.example',
      })
    ).toThrow();
    expect(() =>
      createTransferSubmissionPostgres({ ...config, role: 'postgres' })
    ).toThrow();
    expect(pg.construct).not.toHaveBeenCalled();
  });
});
