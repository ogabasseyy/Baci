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
    constructor(configuration: unknown) {
      pg.construct(configuration);
    }
    query = pg.query;
    connect = pg.connect;
    end = pg.end;
    on = pg.on;
  },
}));

import { checkFinancialReplayReadiness } from './replay-financial-readiness';

const configuration = {
  host: 'piggyvest-db.staging.baci.internal',
  port: 5432,
  database: 'postgres',
  role: 'prefunded_treasury_operator',
  password: 'synthetic-password',
  integrationId: '40000000-0000-4000-8000-000000000001',
  businessId: 'synthetic-business',
  ssl: { ca: 'synthetic-certificate' },
};
const systemId = '7685292944002592802';
const session = {
  login: configuration.role,
  role: configuration.role,
  database: configuration.database,
  read_only: 'on',
  ssl: true,
  unsafe: false,
};
const identity = {
  login: configuration.role,
  database: configuration.database,
  systemIdentifier: systemId,
};

beforeEach(() => {
  vi.clearAllMocks();
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockImplementation(async (statement: string) => {
    if (statement.startsWith('SELECT session_user')) return { rows: [session] };
    if (statement.includes('executor_system_identity()'))
      return { rows: [{ result: identity }] };
    if (statement.includes('has_function_privilege'))
      return { rows: [{ authorized: true }] };
    return { rows: [] };
  });
});

describe('interest-only restricted database readiness', () => {
  it('checks the restricted TLS identity and paid authority in a rollback-only transaction', async () => {
    await expect(
      checkFinancialReplayReadiness(configuration, systemId)
    ).resolves.toBe('ready');
    expect(pg.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'prefunded_treasury_operator',
        ssl: { ca: 'synthetic-certificate', rejectUnauthorized: true },
      })
    );
    const statements = pg.query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe('BEGIN READ ONLY');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(
      statements.some((statement) =>
        /COMMIT|INSERT|UPDATE|DELETE/.test(statement)
      )
    ).toBe(false);
    expect(
      statements.some((statement) =>
        /SELECT piggyvest_savings_ledger\.apply_interest_receipt\(/.test(
          statement
        )
      )
    ).toBe(false);
    expect(pg.end).toHaveBeenCalledOnce();
  });

  it.each([
    { login: 'postgres' },
    { role: 'postgres' },
    { database: 'other' },
    { read_only: 'off' },
    { ssl: false },
    { unsafe: true },
  ])('refuses an unsafe session: %j', async (override) => {
    pg.query.mockResolvedValue({ rows: [{ ...session, ...override }] });
    await expect(
      checkFinancialReplayReadiness(configuration, systemId)
    ).resolves.toBe('transport-unavailable');
    expect(pg.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it.each([
    { systemIdentifier: '7686901100561231906' },
    { login: 'postgres' },
    { database: 'other' },
  ])('refuses mismatched physical database proof: %j', async (override) => {
    pg.query.mockImplementation(async (statement: string) =>
      statement.startsWith('SELECT session_user')
        ? { rows: [session] }
        : { rows: [{ result: { ...identity, ...override } }] }
    );
    await expect(
      checkFinancialReplayReadiness(configuration, systemId)
    ).resolves.toBe('transport-unavailable');
  });

  it('does not report ready when TLS works but the paid bridge authority is absent', async () => {
    pg.query.mockImplementation(async (statement: string) => {
      if (statement.startsWith('SELECT session_user'))
        return { rows: [session] };
      if (statement.includes('executor_system_identity()'))
        return { rows: [{ result: identity }] };
      return { rows: [{ authorized: false }] };
    });
    await expect(
      checkFinancialReplayReadiness(configuration, systemId)
    ).resolves.toBe('authority-unavailable');
  });

  it('refuses TLS errors without exposing connection credentials', async () => {
    pg.connect.mockRejectedValue(new Error('password=synthetic-password'));
    await expect(
      checkFinancialReplayReadiness(configuration, systemId)
    ).resolves.toBe('transport-unavailable');
    expect(pg.end).toHaveBeenCalledOnce();
  });

  it('refuses an unexpected disconnect after the authority response', async () => {
    pg.query.mockImplementation(async (statement: string) => {
      if (statement.startsWith('SELECT session_user'))
        return { rows: [session] };
      if (statement.includes('executor_system_identity()'))
        return { rows: [{ result: identity }] };
      if (statement.includes('has_function_privilege')) {
        pg.on.mock.calls[0][1]();
        return { rows: [{ authorized: true }] };
      }
      return { rows: [] };
    });
    await expect(
      checkFinancialReplayReadiness(configuration, systemId)
    ).resolves.toBe('transport-unavailable');
  });

  it('refuses unverified TLS or a legacy ledger login before connecting', async () => {
    await expect(
      checkFinancialReplayReadiness(
        { ...configuration, ssl: undefined },
        systemId
      )
    ).resolves.toBe('transport-unavailable');
    await expect(
      checkFinancialReplayReadiness(
        {
          ...configuration,
          host: 'baci-isolated-savings-db-1',
          role: 'piggyvest_staging_ledger_worker',
          ssl: undefined,
        },
        systemId
      )
    ).resolves.toBe('transport-unavailable');
    expect(pg.connect).not.toHaveBeenCalled();
  });
});
