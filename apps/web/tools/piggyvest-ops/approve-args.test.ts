import { describe, expect, it } from 'vitest';
import { parseApproveArgs } from './approve-args';

const base = [
  '--host',
  'db.example.supabase.co',
  '--user',
  'pv_approver_amaka',
];

describe('parseApproveArgs', () => {
  it('defaults to listing in dry-run mode on port 5432 of database postgres', () => {
    expect(parseApproveArgs(base)).toEqual({
      ok: true,
      args: {
        host: 'db.example.supabase.co',
        port: 5432,
        database: 'postgres',
        user: 'pv_approver_amaka',
        reject: false,
        commit: false,
        help: false,
      },
    });
  });

  it('reads a decision on one request', () => {
    const parsed = parseApproveArgs([
      ...base,
      '--request',
      '3f0e0000-0000-4000-8000-000000000001',
      '--reject',
      '--commit',
      '--port',
      '6543',
      '--database',
      'baci',
      '--ca',
      '/home/amaka/supabase-ca.crt',
    ]);
    expect(parsed).toMatchObject({
      ok: true,
      args: {
        request: '3f0e0000-0000-4000-8000-000000000001',
        reject: true,
        commit: true,
        port: 6543,
        database: 'baci',
        caFile: '/home/amaka/supabase-ca.crt',
      },
    });
  });

  it('shows help without other arguments', () => {
    expect(parseApproveArgs(['--help'])).toEqual({ ok: true, help: true });
  });

  it.each([
    [['--password', 'hunter2']],
    [['--password=hunter2']],
    [['--pass', 'x']],
    [['--host=db.example.com', '--pgpassword', 'x']],
    [['--secret', 'x']],
  ])('refuses a password on the command line: %j', (extra) => {
    const parsed = parseApproveArgs([...base, ...extra]);
    expect(parsed).toEqual({
      ok: false,
      error:
        'Passwords are never accepted on the command line. You will be asked for yours at a hidden prompt.',
    });
  });

  it('accepts a CA certificate path that happens to contain secret-like words', () => {
    expect(
      parseApproveArgs([...base, '--ca', '/home/amaka/secrets/pass@ca.crt'])
    ).toMatchObject({
      ok: true,
      args: { caFile: '/home/amaka/secrets/pass@ca.crt' },
    });
    expect(parseApproveArgs([...base, '--ca', '--password', 'x']).ok).toBe(
      false
    );
  });

  it('refuses a connection string that could carry a password', () => {
    const parsed = parseApproveArgs([
      '--host',
      'postgresql://pv_approver_amaka:hunter2@db.example.com/postgres',
      '--user',
      'pv_approver_amaka',
    ]);
    expect(parsed).toEqual({
      ok: false,
      error:
        'Passwords are never accepted on the command line. You will be asked for yours at a hidden prompt.',
    });
  });

  it.each([
    [['--user', 'pv_approver_amaka'], 'missing host'],
    [['--host', 'db.example.com'], 'missing user'],
    [[...base, '--commit'], 'commit without a request'],
    [[...base, '--port', 'abc'], 'bad port'],
    [[...base, '--unknown'], 'unknown flag'],
    [[...base, 'stray'], 'stray value'],
    [[...base, '--host', 'other.example.com'], 'repeated flag'],
    [['--host', 'db.example.com', '--user', 'postgres'], 'shared login'],
  ])('refuses %j (%s)', (argv) => {
    expect(parseApproveArgs(argv).ok).toBe(false);
  });
});
