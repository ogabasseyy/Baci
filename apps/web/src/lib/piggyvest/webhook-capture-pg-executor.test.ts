import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ClientConfig } from 'pg';
import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  PIGGYVEST_CAPTURE_WORKER_ROLE,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';
import {
  CaptureDrainDatabaseError,
  type CaptureDrainPgClient,
  createCaptureDrainPgExecutor,
} from './webhook-capture-pg-executor';

import {
  CAPTURE_TEST_PASSWORD as PASSWORD,
  captureTestRuntime as runtime,
  safeCaptureSession as safeSession,
} from './webhook-capture-pg-executor-session.test-support';

interface FakeClient extends CaptureDrainPgClient {
  config: ClientConfig;
  calls: { text: string; values: unknown[] | undefined }[];
  ended: boolean;
}

let session: unknown[];
let statementRows: unknown[];
let connectError: Error | null;
let clients: FakeClient[];

function fakeClient(config: ClientConfig): FakeClient {
  const client: FakeClient = {
    config,
    calls: [],
    ended: false,
    async connect() {
      if (connectError) throw connectError;
    },
    async query(text, values) {
      client.calls.push({ text, values });
      return { rows: text.includes('pg_stat_ssl') ? session : statementRows };
    },
    async end() {
      client.ended = true;
    },
  };
  clients.push(client);
  return client;
}

const executor = () =>
  createCaptureDrainPgExecutor(runtime, { createClient: fakeClient });

beforeEach(() => {
  session = [safeSession];
  statementRows = [{ resolved: true }];
  connectError = null;
  clients = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('createCaptureDrainPgExecutor', () => {
  it('opens no connection until a statement runs', () => {
    executor();
    expect(clients).toEqual([]);
  });

  it('connects as the drain login with verified TLS and a pinned search_path', async () => {
    await executor().query('status', []);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.config).toMatchObject({
      host: 'db.example.supabase.co',
      port: 5432,
      database: 'postgres',
      user: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
      password: PASSWORD,
      ssl: { rejectUnauthorized: true, ca: 'placeholder-ca' },
      options: '-c search_path=pg_catalog',
      application_name: 'baci-piggyvest-capture-drain',
    });
    expect(clients[0]?.config.statement_timeout).toBeGreaterThan(0);
    expect(clients[0]?.config.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it('uses the shared session-pooler login and applies settings before verification', async () => {
    const ref = 'abcdefghijklmnopqrst';
    vi.stubEnv('PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF', ref);
    await executor().query('status', []);
    expect(clients[0]?.config.user).toBe(
      `${PIGGYVEST_CAPTURE_DRAIN_LOGIN}.${ref}`
    );
    expect(clients[0]?.config.options).toBeUndefined();
    expect(clients[0]?.config.statement_timeout).toBeUndefined();
    expect(clients[0]?.calls[0]?.text).toMatch(/^SET search_path/);
    expect(clients[0]?.calls[1]?.text).toContain('SESSION_USER');
  });

  it('verifies the session before running the fixed statement, then closes', async () => {
    const rows = await executor().query('resolve', [
      'capture',
      'token',
      'processed',
      null,
    ]);
    const [verify, statement] = clients[0]?.calls ?? [];
    expect(verify?.text).toContain('SESSION_USER');
    expect(verify?.values).toEqual([
      PIGGYVEST_CAPTURE_WORKER_ROLE,
      PIGGYVEST_CAPTURE_DRAIN_LOGIN,
    ]);
    // The claim-bound entry point: the worker can never reach the tokenless
    // (inline completion) branch of the shared resolve function.
    expect(statement?.text).toBe(
      'SELECT public.resolve_claimed_piggyvest_webhook_capture($1::uuid, $2::uuid, $3::text, $4::text) AS resolved'
    );
    expect(statement?.values).toEqual(['capture', 'token', 'processed', null]);
    expect(rows).toEqual([{ resolved: true }]);
    expect(clients[0]?.ended).toBe(true);
  });

  it('runs the claim and status functions through their fixed statements', async () => {
    await executor().query('claim', [10, 300, 120]);
    await executor().query('status', []);
    expect(clients[0]?.calls[1]?.text).toContain(
      'FROM public.claim_piggyvest_webhook_captures($1::integer, $2::integer, $3::integer)'
    );
    expect(clients[0]?.calls[1]?.values).toEqual([10, 300, 120]);
    expect(clients[1]?.calls[1]?.text).toBe(
      'SELECT public.piggyvest_webhook_capture_status() AS status'
    );
  });

  it.each([
    ['a second role membership', { membership_count: 2 }],
    ['no worker membership', { worker_membership: false }],
    ['a session without TLS', { tls: false }],
    ['another session user', { login_name: 'postgres' }],
    ['a switched current role', { role_name: 'service_role' }],
    ['another database', { database_name: 'other' }],
    ['an elevated login', { login_safe: false }],
    [
      'a login that cannot inherit the worker role grants',
      { grants_usable: false },
    ],
    [
      'a login that holds the capture table or functions',
      { capture_surface_denied: false },
    ],
    [
      'a login with a privilege beyond the entry points and PUBLIC',
      { unexpected_privileges: 1 },
    ],
  ])('refuses %s and runs no statement', async (_label, override) => {
    session = [{ ...safeSession, ...override }];
    await expect(executor().query('claim', [10, 300, 120])).rejects.toThrow(
      'PiggyVest capture drain database unavailable'
    );
    expect(clients[0]?.calls).toHaveLength(1);
    expect(clients[0]?.ended).toBe(true);
  });

  it.each([
    ['no verification row', []],
    ['two verification rows', [safeSession, safeSession]],
    ['a malformed verification row', [{ ...safeSession, tls: 'true' }]],
    [
      'a row with no privilege count',
      [{ ...safeSession, unexpected_privileges: null }],
    ],
  ])('refuses %s', async (_label, rows) => {
    session = rows;
    await expect(executor().query('status', [])).rejects.toThrow(
      'PiggyVest capture drain database unavailable'
    );
    expect(clients[0]?.calls).toHaveLength(1);
  });

  it('never surfaces connection details or the password in its error', async () => {
    connectError = new Error(`password authentication failed: ${PASSWORD}`);
    const failure = await executor()
      .query('status', [])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error('Expected an Error');
    expect(failure.message).not.toContain(PASSWORD);
    expect(clients[0]?.ended).toBe(true);
  });

  it('passes on only the SQLSTATE class of a database error, never its message', async () => {
    const failing = (config: ClientConfig) => {
      const client = fakeClient(config);
      client.query = async (text) => {
        if (text.includes('pg_stat_ssl')) return { rows: session };
        throw Object.assign(
          new Error(
            'function public.piggyvest_webhook_capture_status() does not exist'
          ),
          { code: '42883' }
        );
      };
      return client;
    };
    const failure = await createCaptureDrainPgExecutor(runtime, {
      createClient: failing,
    })
      .query('status', [])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CaptureDrainDatabaseError);
    if (!(failure instanceof CaptureDrainDatabaseError))
      throw new Error('Expected a capture drain database error');
    expect(failure.sqlState).toBe('42883');
    expect(failure.message).toBe(
      'PiggyVest capture drain database unavailable'
    );

    session = [{ ...safeSession, tls: false }];
    const unsafe = await executor()
      .query('status', [])
      .catch((error: unknown) => error);
    if (!(unsafe instanceof CaptureDrainDatabaseError))
      throw new Error('Expected a capture drain database error');
    expect(unsafe.sqlState).toBeNull();
  });

  it('still reports the original failure when closing the connection fails', async () => {
    session = [{ ...safeSession, tls: false }];
    const failingEnd = (config: ClientConfig) => {
      const client = fakeClient(config);
      client.end = async () => {
        throw new Error('socket already closed');
      };
      return client;
    };
    await expect(
      createCaptureDrainPgExecutor(runtime, { createClient: failingEnd }).query(
        'status',
        []
      )
    ).rejects.toThrow('PiggyVest capture drain database unavailable');
  });
});

describe('verifySession', () => {
  it('reports a safe session without running any drain statement', async () => {
    await expect(executor().verifySession()).resolves.toEqual({ ok: true });
    expect(clients[0]?.calls).toHaveLength(1);
    expect(clients[0]?.ended).toBe(true);
  });

  it('names every failed check of an unsafe session, never a value', async () => {
    session = [
      {
        ...safeSession,
        login_name: 'postgres',
        membership_count: 2,
        tls: false,
      },
    ];
    const verdict = await executor().verifySession();
    expect(verdict).toEqual({
      ok: false,
      reason: 'unsafe',
      failedChecks: ['session_user', 'membership', 'tls'],
    });
  });

  it.each([
    [{ grants_usable: false }, ['grants']],
    [{ capture_surface_denied: false }, ['capture_surface']],
    [{ unexpected_privileges: 3 }, ['extra_privileges']],
    [
      {
        grants_usable: false,
        capture_surface_denied: false,
        unexpected_privileges: 2,
      },
      ['grants', 'capture_surface', 'extra_privileges'],
    ],
  ])('names a login that cannot use, or reaches beyond, its grants: %j', async (override, failedChecks) => {
    session = [{ ...safeSession, ...override }];
    await expect(executor().verifySession()).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
      failedChecks,
    });
  });

  it('reports an unreachable database separately from an unsafe one', async () => {
    connectError = new Error('connect ETIMEDOUT');
    await expect(executor().verifySession()).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });
});
