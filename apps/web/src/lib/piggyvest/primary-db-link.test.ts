import { afterEach, describe, expect, it, vi } from 'vitest';
import { primaryDbLink } from './primary-db-link';

const REF = 'abcdefghijklmnopqrst';
const ENV = 'PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF';

afterEach(() => {
  vi.unstubAllEnvs();
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
