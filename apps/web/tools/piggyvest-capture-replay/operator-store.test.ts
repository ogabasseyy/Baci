import type { ClientConfig } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  createOperatorStore,
  OPERATOR_STATEMENTS,
  OPERATOR_VERIFY_SESSION_SQL,
  type OperatorQueryClient,
  OperatorRefusal,
  readOperatorConnection,
  sessionFailures,
} from './operator-store';

const CAPTURE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const goodSession = {
  login_name: 'ops_alice',
  login_safe: true,
  operator_member: true,
  pipeline_member: false,
  extra_membership: false,
  pipeline_function_access: false,
  direct_table_access: false,
  grants_usable: true,
  secure_transport: true,
};

function fakeClient(
  session: unknown,
  result: Record<string, unknown> | undefined
) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const configs: ClientConfig[] = [];
  const end = vi.fn(async () => undefined);
  const createClient = (config: ClientConfig): OperatorQueryClient => {
    configs.push(config);
    return {
      connect: async () => undefined,
      end,
      query: async (text, values) => {
        calls.push({ text, values });
        if (text === OPERATOR_VERIFY_SESSION_SQL)
          return {
            rows:
              session === undefined ? [] : [session as Record<string, unknown>],
          };
        return { rows: result === undefined ? [] : [result] };
      },
    };
  };
  return { calls, configs, end, createClient };
}

describe('sessionFailures', () => {
  it('accepts a personal operator login over an encrypted connection', () => {
    expect(sessionFailures(goodSession)).toEqual([]);
  });

  it.each([
    [{ login_name: 'postgres' }, 'shared platform login'],
    [{ login_name: 'service_role' }, 'shared platform login'],
    [{ login_safe: false }, 'elevated attribute'],
    [{ operator_member: false }, 'not a member'],
    [{ pipeline_member: true }, 'capture pipeline'],
    [{ extra_membership: true }, 'only'],
    [{ pipeline_function_access: true }, 'pipeline functions'],
    [{ direct_table_access: true }, 'directly'],
    [
      { login_name: 'baci_piggyvest_webhook_capture_drain' },
      'shared platform login',
    ],
    [{ grants_usable: false }, 'grants are not usable'],
    [{ secure_transport: false }, 'not encrypted'],
  ])('refuses %o', (override, message) => {
    expect(sessionFailures({ ...goodSession, ...override }).join()).toContain(
      message
    );
  });
});

describe('createOperatorStore', () => {
  it('verifies the session before requeueing and closes the connection', async () => {
    const result = {
      outcome: 'requeued',
      auditId: 3,
      previousAttempts: 20,
      previousLastError: 'REPLAY_FAILED',
      operatorReplays: 1,
      replayLimit: 5,
    };
    const fake = fakeClient(goodSession, { result });
    const store = createOperatorStore({
      connectionString: 'postgres://ops@db.example.test/postgres',
      createClient: fake.createClient,
    });

    await expect(
      store.requeue(CAPTURE, 'fix deployed, replay')
    ).resolves.toEqual(result);

    expect(fake.calls.map((call) => call.text)).toEqual([
      OPERATOR_VERIFY_SESSION_SQL,
      OPERATOR_STATEMENTS.requeue,
    ]);
    expect(fake.calls[0]?.values).toEqual([
      'piggyvest_webhook_capture_operator',
      ['piggyvest_webhook_capture_worker', 'piggyvest_webhook_intake'],
    ]);
    expect(fake.calls[1]?.values).toEqual([CAPTURE, 'fix deployed, replay']);
    expect(fake.configs[0]?.ssl).toEqual({ rejectUnauthorized: true });
    expect(fake.end).toHaveBeenCalledTimes(1);
  });

  it('does not force TLS options on a loopback database', async () => {
    const fake = fakeClient(goodSession, { captures: [] });
    await createOperatorStore({
      connectionString: 'postgres://ops@127.0.0.1:55439/postgres',
      createClient: fake.createClient,
    }).list(10);
    expect(fake.configs[0]?.ssl).toBeUndefined();
  });

  it('runs nothing when the session is refused, and still closes', async () => {
    const fake = fakeClient(
      { ...goodSession, operator_member: false },
      undefined
    );
    const store = createOperatorStore({
      connectionString: 'postgres://anon@db.example.test/postgres',
      createClient: fake.createClient,
    });

    await expect(
      store.requeue(CAPTURE, 'fix deployed, replay')
    ).rejects.toBeInstanceOf(OperatorRefusal);
    expect(fake.calls).toHaveLength(1);
    expect(fake.end).toHaveBeenCalledTimes(1);
  });

  it('refuses when the session row is missing', async () => {
    const fake = fakeClient(undefined, undefined);
    await expect(
      createOperatorStore({
        connectionString: 'postgres://x@db.example.test/postgres',
        createClient: fake.createClient,
      }).list(5)
    ).rejects.toThrow('session could not be verified');
  });

  it('rejects a list response that does not match the contract', async () => {
    const fake = fakeClient(goodSession, { captures: [{ captureId: 'nope' }] });
    await expect(
      createOperatorStore({
        connectionString: 'postgres://ops@db.example.test/postgres',
        createClient: fake.createClient,
      }).list(5)
    ).rejects.toThrow();
  });
});

describe('readOperatorConnection', () => {
  it('accepts a remote host with no sslmode or verify-full, and a loopback host', () => {
    expect(
      readOperatorConnection('postgres://ops@db.example.test/postgres')
    ).toEqual({ loopback: false });
    expect(
      readOperatorConnection(
        'postgresql://ops@db.example.test/postgres?sslmode=verify-full'
      )
    ).toEqual({ loopback: false });
    expect(
      readOperatorConnection(
        'postgres://ops@127.0.0.1:5432/postgres?sslmode=disable'
      )
    ).toEqual({ loopback: true });
  });

  it.each([
    [
      'postgres://ops@db.example.test/postgres?sslmode=no-verify',
      'verify-full',
    ],
    ['postgres://ops@db.example.test/postgres?sslmode=require', 'verify-full'],
    ['postgres://ops@db.example.test/postgres?sslmode=disable', 'verify-full'],
    [
      'postgres://ops@db.example.test/postgres?sslrootcert=/tmp/x',
      'sslrootcert',
    ],
    ['postgres:///postgres?host=db.example.test', 'host directly'],
    ['postgres://ops@localhost/postgres?host=db.example.test', 'host directly'],
    // node-postgres uses the LAST repeated value, so these must not connect.
    [
      'postgres://ops@db.example.test/postgres?sslmode=verify-full&sslmode=no-verify',
      'repeats sslmode',
    ],
    [
      'postgres://ops@db.example.test/postgres?sslmode=verify-full&sslmode=disable',
      'repeats sslmode',
    ],
    // Through the pooler the server-side TLS check would attest the wrong hop.
    [
      'postgres://ops@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
      'not the pooler',
    ],
    ['postgres://ops@my-pgbouncer.internal:5432/postgres', 'not the pooler'],
    // A pooler host on another port is refused too.
    [
      'postgres://ops@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
      'not the pooler',
    ],
    ['mysql://ops@db.example.test/x', 'postgres URL'],
    ['not a url', 'valid URL'],
  ])('refuses %s before connecting', (url, message) => {
    const createClient = vi.fn();
    expect(() =>
      createOperatorStore({ connectionString: url, createClient })
    ).toThrow(message);
    expect(createClient).not.toHaveBeenCalled();
  });
});
