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

import { createFinancialReplayPostgres } from './replay-financial-postgres';
import { PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS } from './transfer-outbox-finality-statements';

const config = {
  host: 'baci-isolated-savings-db-1',
  port: 5432,
  database: 'postgres',
  role: 'piggyvest_staging_ledger_worker',
  password: 'synthetic-password',
  integrationId: '40000000-0000-4000-8000-000000000001',
  businessId: 'business',
};
const statement =
  'SELECT piggyvest_savings_ledger.apply_interest_receipt($1::uuid,$2::text,$3::text,$4::jsonb,$5::text) AS result';
beforeEach(() => {
  vi.clearAllMocks();
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockImplementation(async (query: string) =>
    query.startsWith('SELECT session_user')
      ? {
          rows: [
            {
              login: 'piggyvest_staging_ledger_worker',
              role: 'piggyvest_staging_ledger_worker',
              database: 'postgres',
            },
          ],
        }
      : query === 'COMMIT'
        ? { command: 'COMMIT' }
        : { rows: [{ result: 'applied' }] }
  );
});
describe('restricted financial replay transport', () => {
  it('uses the existing treasury login only for paid interest over verified TLS', async () => {
    const treasury = {
      ...config,
      host: 'piggyvest-db.staging.baci.internal',
      role: 'prefunded_treasury_operator',
      ssl: { ca: 'synthetic-certificate' },
    };
    pg.query.mockImplementation(async (query: string) =>
      query.startsWith('SELECT session_user')
        ? {
            rows: [
              {
                login: treasury.role,
                role: treasury.role,
                database: 'postgres',
              },
            ],
          }
        : query === 'COMMIT'
          ? { command: 'COMMIT' }
          : { rows: [{ result: 'applied' }] }
    );

    await expect(
      createFinancialReplayPostgres(treasury)(statement, [
        'a',
        'b',
        '123',
        '{}',
        'event',
      ])
    ).resolves.toEqual({ rows: [{ result: 'applied' }] });
    expect(pg.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        host: treasury.host,
        ssl: { ca: treasury.ssl.ca, rejectUnauthorized: true },
      })
    );
    pg.connect.mockClear();
    await expect(
      createFinancialReplayPostgres(treasury)(
        PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected.text,
        ['123', 'outflow', 'customer', 'business', config.integrationId]
      )
    ).rejects.toThrow('Financial replay database unavailable');
    expect(pg.connect).not.toHaveBeenCalled();
  });
  it('refuses an existing treasury login without verified TLS configuration', () => {
    expect(() =>
      createFinancialReplayPostgres({
        ...config,
        host: 'piggyvest-db.staging.baci.internal',
        role: 'prefunded_treasury_operator',
      })
    ).toThrow();
    expect(() =>
      createFinancialReplayPostgres({
        ...config,
        role: 'prefunded_treasury_operator',
        ssl: { ca: '', rejectUnauthorized: false },
      })
    ).toThrow();
    expect(pg.construct).not.toHaveBeenCalled();
  });
  it('does not submit paid interest when certificate validation fails', async () => {
    pg.connect.mockRejectedValue(new Error('ERR_TLS_CERT_ALTNAME_INVALID'));
    await expect(
      createFinancialReplayPostgres({
        ...config,
        host: 'piggyvest-db.staging.baci.internal',
        role: 'prefunded_treasury_operator',
        ssl: { ca: 'wrong-certificate' },
      })(statement, ['a', 'b', '123', '{}', 'event'])
    ).rejects.toThrow('Financial replay database unavailable');
    expect(pg.query).not.toHaveBeenCalledWith(statement, expect.anything());
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it('commits only the dedicated observation function while preserving raw decimal text', async () => {
    const observation =
      'SELECT piggyvest_staging.record_interest_accrual($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::json) AS result';
    const parameters = [
      'integration',
      'business',
      '123',
      'receipt',
      'a'.repeat(64),
      '{"amount":406.8493150684931234}',
    ];
    await expect(
      createFinancialReplayPostgres(config)(observation, parameters)
    ).resolves.toEqual({ rows: [{ result: 'applied' }] });
    expect(pg.query).toHaveBeenCalledWith(observation, parameters);
    expect(pg.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('commits the allowlisted statement before returning an acknowledgement', async () => {
    await expect(
      createFinancialReplayPostgres(config)(statement, [
        'a',
        'b',
        '123',
        '{}',
        'event',
      ])
    ).resolves.toEqual({ rows: [{ result: 'applied' }] });
    expect(pg.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it('allows the scoped customer lookup exported by the finality statement registry', async () => {
    const scopedRead = PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected;

    await expect(
      createFinancialReplayPostgres(config)(scopedRead.text, [
        '123456789',
        'synthetic-outflow-001',
        'provider-customer-001',
        'business',
        config.integrationId,
      ])
    ).resolves.toEqual({ rows: [{ result: 'applied' }] });
    expect(pg.query).toHaveBeenCalledWith(scopedRead.text, expect.any(Array));
  });
  it('rejects arbitrary SQL without connecting', async () => {
    await expect(
      createFinancialReplayPostgres(config)('DELETE FROM customers', [])
    ).rejects.toThrow();
    expect(pg.connect).not.toHaveBeenCalled();
  });
  it('rejects a different database login and rolls back', async () => {
    pg.query.mockResolvedValue({
      rows: [{ login: 'postgres', role: 'postgres', database: 'postgres' }],
    });
    await expect(
      createFinancialReplayPostgres(config)(statement, [
        'a',
        'b',
        '123',
        '{}',
        'event',
      ])
    ).rejects.toThrow();
    expect(pg.query).not.toHaveBeenCalledWith(statement, expect.anything());
    expect(pg.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('does not acknowledge commit failure or disclose its error', async () => {
    pg.query.mockImplementation(async (query: string) => {
      if (query === 'COMMIT') throw new Error('password=secret');
      return query.startsWith('SELECT session_user')
        ? {
            rows: [
              { login: config.role, role: config.role, database: 'postgres' },
            ],
          }
        : { rows: [{ result: 'applied' }] };
    });
    await expect(
      createFinancialReplayPostgres(config)(statement, [
        'a',
        'b',
        '123',
        '{}',
        'event',
      ])
    ).rejects.toThrow('Financial replay database unavailable');
  });
  it('rejects production hosts and privileged roles before creating clients', () => {
    expect(() =>
      createFinancialReplayPostgres({ ...config, host: 'production.example' })
    ).toThrow();
    expect(() =>
      createFinancialReplayPostgres({ ...config, role: 'postgres' })
    ).toThrow();
    expect(pg.construct).not.toHaveBeenCalled();
  });
});
