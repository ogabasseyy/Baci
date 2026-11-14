import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPiggyvestWebhookIntakeExecutor,
  PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS,
  PiggyvestIntakeDbError,
} from './webhook-intake-executor';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  options: vi.fn(),
  on: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.options(options);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
    on = mocks.on;
  },
}));

const config = {
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_webhook_intake',
    password: 'test-only',
    certificateAuthority: 'test-ca',
  },
} as const;
const safeSession = {
  rows: [
    {
      database_name: 'postgres',
      login_name: config.database.login,
      role_name: config.database.login,
      safe: true,
      tls: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockResolvedValue(undefined);
  mocks.connect.mockResolvedValue(undefined);
  mocks.query.mockReset();
  mocks.query.mockResolvedValueOnce(safeSession);
});

describe('createPiggyvestWebhookIntakeExecutor', () => {
  it('verifies the restricted TLS session, then runs one fixed statement', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ result: { outcome: 'ok' } }],
    });
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    expect(await execute('claim_event', { event_id: 'e1' })).toEqual({
      outcome: 'ok',
    });
    expect(mocks.query).toHaveBeenLastCalledWith(
      'SELECT piggyvest_webhook_intake.claim_event($1::jsonb) AS result',
      ['{"event_id":"e1"}']
    );
    expect(mocks.options).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'baci_piggyvest_webhook_intake',
        ssl: { rejectUnauthorized: true, ca: 'test-ca' },
        options: '-c search_path=pg_catalog',
      })
    );
    await execute.close();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('runs N operations over exactly one connection and one session verification', async () => {
    for (let i = 0; i < 5; i += 1)
      mocks.query.mockResolvedValueOnce({ rows: [{ result: { i } }] });
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    for (let i = 0; i < 5; i += 1)
      expect(await execute('inbox_read', { event_id: `e${i}` })).toEqual({ i });
    expect(mocks.options).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    // one verification + five statements
    expect(mocks.query).toHaveBeenCalledTimes(6);
    expect(mocks.end).not.toHaveBeenCalled();
    await execute.close();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('shares one connection between concurrent operations', async () => {
    mocks.query.mockResolvedValue({ rows: [{ result: 1 }] });
    mocks.query.mockResolvedValueOnce(safeSession);
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    await Promise.all([
      execute('inbox_read', {}),
      execute('claim_event', {}),
      execute('plan_wallet_read', {}),
    ]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    await execute.close();
  });

  it('closes the connection after a statement error and still maps only the SQLSTATE', async () => {
    mocks.query.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: '23505' })
    );
    mocks.query.mockResolvedValueOnce({ rows: [{ result: 'ok' }] });
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    await expect(execute('inbox_insert', {})).rejects.toMatchObject({
      code: '23505',
    });
    // the connection survives a statement failure: later operations reuse it
    expect(await execute('inbox_read', {})).toBe('ok');
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    await execute.close();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('refuses work after close and never reconnects', async () => {
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    await execute.close();
    await expect(execute('claim_event', {})).rejects.toBeInstanceOf(
      PiggyvestIntakeDbError
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.end).not.toHaveBeenCalled();
  });

  it('exposes only the reviewed function names', () => {
    expect([...PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS].sort()).toEqual(
      [
        'allocate_plan_transfer',
        'apply_staging_restriction',
        'capture_delivery',
        'claim_event',
        'inbox_insert',
        'inbox_read',
        'inflow_credit_insert',
        'inflow_credit_read',
        'interest_payout_insert',
        'interest_payout_read',
        'outbox_apply_terminal',
        'plan_wallet_read',
        'plan_wallet_set_status',
        'quarantine_insert',
        'resolve_capture',
        'resolve_event',
        'resolve_staging_owner',
      ].sort()
    );
  });

  it('refuses an unknown function, a non-object payload or an oversize one before connecting', async () => {
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    for (const [fn, payload] of [
      ['claim_event; SELECT 1', {}],
      ['pg_sleep', {}],
      ['claim_event', 'text'],
      ['claim_event', null],
      ['claim_event', [1]],
      ['claim_event', { big: 'x'.repeat(600_000) }],
    ] as const)
      await expect(execute(fn as never, payload)).rejects.toThrow();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects a session that is not the restricted login over TLS', async () => {
    for (const bad of [
      { safe: false },
      { tls: false },
      { login_name: 'postgres' },
      { role_name: 'service_role' },
      { database_name: 'other' },
    ]) {
      mocks.query.mockReset();
      mocks.query.mockResolvedValueOnce({
        rows: [{ ...safeSession.rows[0], ...bad }],
      });
      const execute = createPiggyvestWebhookIntakeExecutor(config);
      await expect(execute('claim_event', {})).rejects.toThrow(
        'PiggyVest intake database unavailable'
      );
      expect(mocks.query).toHaveBeenCalledTimes(1);
      // fail closed: the unverified connection is closed and not reused
      expect(mocks.end).toHaveBeenCalledOnce();
      await expect(execute('claim_event', {})).rejects.toThrow();
      expect(mocks.query).toHaveBeenCalledTimes(1);
      expect(mocks.connect).toHaveBeenCalledOnce();
      mocks.connect.mockClear();
      mocks.end.mockClear();
      mocks.query.mockClear();
    }
  });

  it('keeps only the SQLSTATE of a statement failure', async () => {
    mocks.query.mockRejectedValueOnce(
      Object.assign(new Error('secret host detail'), { code: 'P0001' })
    );
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    const failure = await execute('allocate_plan_transfer', {}).catch(
      (e: unknown) => e
    );
    expect(failure).toBeInstanceOf(PiggyvestIntakeDbError);
    expect((failure as PiggyvestIntakeDbError).code).toBe('P0001');
    expect((failure as Error).message).not.toContain('secret');
    await execute.close();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('reports a connection failure without any code', async () => {
    mocks.connect.mockRejectedValueOnce(
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    );
    const execute = createPiggyvestWebhookIntakeExecutor(config);
    const failure = await execute('claim_event', {}).catch((e: unknown) => e);
    expect((failure as PiggyvestIntakeDbError).code).toBeUndefined();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('rejects a configuration with another login', () => {
    expect(() =>
      createPiggyvestWebhookIntakeExecutor({
        database: { ...config.database, login: 'service_role' },
      })
    ).toThrow();
  });
});
