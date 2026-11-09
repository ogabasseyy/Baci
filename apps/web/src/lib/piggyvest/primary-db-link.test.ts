import { afterEach, describe, expect, it, vi } from 'vitest';
import { primaryDbLink } from './primary-db-link';

const REF = 'abcdefghijklmnopqrst';
const ENV = 'PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF';

const NAME_ENV = 'PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME';
const SERVER_NAME = `db.${REF}.supabase.co`;

afterEach(() => {
  vi.unstubAllEnvs();
});

const certFor = (san: string) =>
  ({ subject: { CN: 'x' }, subjectaltname: san }) as never;

describe('primaryDbLink forwarder (server-name) mode', () => {
  it('has an empty tls object when the server name is unset', () => {
    vi.stubEnv(ENV, '');
    vi.stubEnv(NAME_ENV, '');
    expect(primaryDbLink('baci_x', 5432).tls).toEqual({});
  });

  it('keeps the bare login and direct startup settings when set', () => {
    vi.stubEnv(ENV, '');
    vi.stubEnv(NAME_ENV, SERVER_NAME);
    const link = primaryDbLink('baci_x', 15432);
    expect(link.user).toBe('baci_x');
    expect(link.startup).toEqual({
      options: '-c search_path=pg_catalog',
      statement_timeout: 2500,
      lock_timeout: 1500,
    });
    expect(typeof link.tls.checkServerIdentity).toBe('function');
  });

  it('verifies the certificate against the configured server name', () => {
    vi.stubEnv(ENV, '');
    vi.stubEnv(NAME_ENV, SERVER_NAME);
    const check = primaryDbLink('baci_x', 15432).tls.checkServerIdentity;
    expect(check?.('pg-relay.usebaci.com', certFor(`DNS:${SERVER_NAME}`))).toBe(
      undefined
    );
    expect(
      check?.('pg-relay.usebaci.com', certFor('DNS:pg-relay.usebaci.com'))
    ).toBeInstanceOf(Error);
  });

  it.each([
    'pg-relay.usebaci.com',
    `${SERVER_NAME}.evil.com`,
    ` ${SERVER_NAME}`,
  ])('refuses a malformed server name %j', (name) => {
    vi.stubEnv(ENV, '');
    vi.stubEnv(NAME_ENV, name);
    expect(() => primaryDbLink('baci_x', 15432)).toThrow(
      'PiggyVest database pooler configuration invalid'
    );
  });

  it('refuses pooler ref and server name set together', () => {
    vi.stubEnv(ENV, REF);
    vi.stubEnv(NAME_ENV, SERVER_NAME);
    expect(() => primaryDbLink('baci_x', 5432)).toThrow(
      'PiggyVest database pooler configuration invalid'
    );
  });

  it('has an empty tls object in pooler mode', () => {
    vi.stubEnv(ENV, REF);
    vi.stubEnv(NAME_ENV, '');
    expect(primaryDbLink('baci_x', 5432).tls).toEqual({});
  });
});

describe('primaryDbLink', () => {
  it('keeps the bare login and startup settings when the pooler ref is unset', async () => {
    vi.stubEnv(ENV, '');
    const link = primaryDbLink('baci_piggyvest_primary_evidence', 5432);
    expect(link.user).toBe('baci_piggyvest_primary_evidence');
    expect(link.startup).toEqual({
      options: '-c search_path=pg_catalog',
      statement_timeout: 2500,
      lock_timeout: 1500,
    });
    const query = vi.fn();
    await link.afterConnect({ query });
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the bare login and startup settings when the pooler ref is absent', () => {
    vi.stubEnv(ENV, '');
    delete process.env[ENV];
    const link = primaryDbLink('baci_x', 5432);
    expect(link.user).toBe('baci_x');
    expect(link.startup.options).toBe('-c search_path=pg_catalog');
  });

  it('suffixes the login with the project ref in pooler mode', () => {
    vi.stubEnv(ENV, REF);
    expect(primaryDbLink('baci_x', 5432).user).toBe(`baci_x.${REF}`);
  });

  it('sends no startup options in pooler mode and sets them on the session', async () => {
    vi.stubEnv(ENV, REF);
    const link = primaryDbLink('baci_x', 5432);
    expect(link.startup).toEqual({});
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await link.afterConnect({ query });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SET search_path TO pg_catalog; SET statement_timeout = 2500; SET lock_timeout = 1500'
    );
  });

  it.each([
    'ABCDEFGHIJKLMNOPQRST',
    'short',
    `${REF}x`,
    'abcdefghijklmnopqr.t',
    ` ${REF}`,
  ])('refuses a malformed ref %j', (ref) => {
    vi.stubEnv(ENV, ref);
    expect(() => primaryDbLink('baci_x', 5432)).toThrow(
      'PiggyVest database pooler configuration invalid'
    );
  });

  it('refuses the transaction pooler port in pooler mode', () => {
    vi.stubEnv(ENV, REF);
    expect(() => primaryDbLink('baci_x', 6543)).toThrow(
      'PiggyVest database pooler configuration invalid'
    );
  });
});
