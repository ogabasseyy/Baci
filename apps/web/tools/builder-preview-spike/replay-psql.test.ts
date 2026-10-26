// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { replayClientArgs } from './replay-psql.mjs';

describe('owned disposable replay PostgreSQL client', () => {
  const name = 'supabase_db_baci_replay_012345678901234567890123';
  const environment = {
    PGHOST: '127.0.0.1',
    PGPORT: '55432',
    PGDATABASE: 'postgres',
    PGUSER: 'postgres',
  };
  it('refuses non-loopback, unowned and ambiguous database destinations', () => {
    expect(() =>
      replayClientArgs(
        { ...environment, PGHOST: 'production.example' },
        [name],
        ['-At']
      )
    ).toThrow();
    expect(() =>
      replayClientArgs(environment, ['supabase_db_other-project'], ['-At'])
    ).toThrow();
    expect(() =>
      replayClientArgs(environment, [name, name], ['-At'])
    ).toThrow();
  });
  it('uses the pinned client in the owned database network namespace', () => {
    const args = replayClientArgs(environment, [name], ['-At']);
    expect(args).toContain(`container:${name}`);
    expect(args).toContain('postgres:18.3');
    expect(args.slice(-2)).toEqual(['psql', '-At']);
    expect(args.join(' ')).not.toContain('password');
  });
});
