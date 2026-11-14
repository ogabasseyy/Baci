import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { createPiggyvestWebhookIntakeExecutor } from './webhook-intake-executor';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  query: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.options(options);
    }
    connect = vi.fn().mockResolvedValue(undefined);
    query = mocks.query;
    end = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
  },
}));

const REF = 'abcdefghijklmnopqrst';
const database = {
  host: 'aws-0-eu-west-1.pooler.supabase.com',
  port: 5432,
  name: 'postgres',
  login: 'baci_piggyvest_primary_evidence',
  password: 'test-only',
  certificateAuthority: 'test-ca',
};
const evidenceConfig = {
  integrationId: '11111111-1111-4111-8111-111111111111',
  environment: 'staging',
  database,
};
const statement =
  'SELECT piggyvest_primary.read_dispatched_savings($1::uuid,$2::text,$3::uuid) AS result';

const safeRow = (login: string) => ({
  rows: [
    {
      database_name: 'postgres',
      login_name: login,
      role_name: login,
      safe: true,
      tls: true,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF', REF);
});
afterEach(() => vi.unstubAllEnvs());

describe('pooler mode through real executors', () => {
  it('evidence executor: suffixed user, SET before verify, bare-login verification', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(safeRow(database.login))
      .mockResolvedValueOnce({ rows: [{ result: null }] });
    const execute = createPrimaryWalletEvidenceExecutor(evidenceConfig);
    await execute(statement, [
      evidenceConfig.integrationId,
      'staging',
      '22222222-2222-4222-8222-222222222222',
    ]);
    const client = mocks.options.mock.calls[0]?.[0];
    expect(client.user).toBe(`${database.login}.${REF}`);
    expect(client.options).toBeUndefined();
    expect(client.statement_timeout).toBeUndefined();
    expect(client.lock_timeout).toBeUndefined();
    expect(client.ssl).toEqual({ rejectUnauthorized: true, ca: 'test-ca' });
    expect(mocks.query.mock.calls[0]?.[0]).toMatch(/^SET search_path/);
  });

  it('evidence executor refuses a malformed ref without connecting', async () => {
    vi.stubEnv('PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF', 'bad');
    const execute = createPrimaryWalletEvidenceExecutor(evidenceConfig);
    await expect(
      execute(statement, [
        evidenceConfig.integrationId,
        'staging',
        '22222222-2222-4222-8222-222222222222',
      ])
    ).rejects.toThrow();
    expect(mocks.options).not.toHaveBeenCalled();
  });

  it('webhook intake executor: suffixed user, bare-login verification', async () => {
    const login = 'baci_piggyvest_webhook_intake';
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(safeRow(login))
      .mockResolvedValueOnce({ rows: [{ result: { ok: true } }] });
    const execute = createPiggyvestWebhookIntakeExecutor({
      database: { ...database, login },
    });
    await execute('claim_event', {});
    await execute.close();
    expect(mocks.options.mock.calls[0]?.[0].user).toBe(`${login}.${REF}`);
    expect(mocks.options.mock.calls[0]?.[0].options).toBeUndefined();
  });
});

describe('server-name (forwarder) mode through a real executor', () => {
  it('passes ssl.checkServerIdentity to the pg Client', async () => {
    vi.stubEnv('PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF', '');
    vi.stubEnv('PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME', `db.${REF}.supabase.co`);
    mocks.query
      .mockResolvedValueOnce(safeRow(database.login))
      .mockResolvedValueOnce({ rows: [{ result: null }] });
    const execute = createPrimaryWalletEvidenceExecutor(evidenceConfig);
    await execute(statement, [
      evidenceConfig.integrationId,
      'staging',
      '22222222-2222-4222-8222-222222222222',
    ]);
    const client = mocks.options.mock.calls[0]?.[0];
    expect(client.user).toBe(database.login);
    expect(client.ssl.rejectUnauthorized).toBe(true);
    expect(client.ssl.ca).toBe('test-ca');
    expect(typeof client.ssl.checkServerIdentity).toBe('function');
  });
});

const EXECUTORS = [
  'primary-savings-provisioning-executor',
  'primary-wallet-bank-inbox-store',
  'primary-wallet-card-checkout-executor',
  'primary-wallet-card-custody-executor',
  'primary-wallet-evidence-executor',
  'primary-wallet-executor',
  'primary-wallet-inflow-executor',
  'primary-wallet-paid-interest-inbox-store',
  'primary-wallet-paid-interest-store',
  'primary-wallet-savings-executor',
  'webhook-intake-executor',
];

describe('every restricted-login executor uses the shared helper', () => {
  it.each(EXECUTORS)('%s', (name) => {
    const source = readFileSync(join(__dirname, `${name}.ts`), 'utf8');
    expect(source).toContain("from './primary-db-link'");
    expect(source).toMatch(/user: link\.user,/);
    expect(source).toContain('...link.startup,');
    expect(source).toMatch(/ssl: \{[^}]*\.\.\.link\.tls[^}]*\}/);
    const afterConnect = source.indexOf('await link.afterConnect(client);');
    expect(afterConnect).toBeGreaterThan(-1);
    expect(afterConnect).toBeLessThan(source.indexOf('client.query('));
    expect(source).not.toMatch(/user: [\w.]*login,/);
    expect(source).not.toContain("options: '-c search_path=pg_catalog'");
  });
});
