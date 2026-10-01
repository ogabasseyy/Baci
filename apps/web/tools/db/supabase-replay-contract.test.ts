import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReplayCommand } from './supabase-history-replay-types';
import {
  assertSupabaseReplayDatabaseUrl,
  createSupabaseReplayDatabaseEnvironment,
  isSupabaseReplayLoopbackHost,
  parseSupabaseReplayArguments,
  readReplayCommandExecutionTimeoutMs,
  readSupabaseReplayDatabaseUrl,
  verifySupabaseReplayContract,
} from './supabase-replay-contract';

const outputs = {
  node: '24.11.1',
  pnpm: '11.7.0\n',
  psql: 'psql (PostgreSQL) 18.3\n',
  supabase: '2.95.4\n',
  tsc: 'Version 7.0.2\n',
  tsx: 'tsx v4.22.4\nnode v24.11.1\n',
};
const invalidArguments: [string[]][] = [
  [[]],
  [['--mode', 'chronological']],
  [['--mode', 'unknown', '--pending-repair-state', 'materialized']],
  [['--mode', 'chronological', '--pending-repair-state', 'auto']],
  [
    [
      '--mode',
      'chronological',
      '--pending-repair-state',
      'materialized',
      '--comparison-mode',
      'unknown',
    ],
  ],
  [
    [
      '--mode',
      'chronological',
      '--pending-repair-state',
      'materialized',
      '--production-old-cancellation-proof',
      'unknown',
    ],
  ],
  [['--unknown', 'value']],
];

function commandWith(overrides: Partial<typeof outputs> = {}): ReplayCommand {
  const values = { ...outputs, ...overrides };
  return async (command, args) => {
    if (command === 'pnpm' && args[0] === '--version') {
      return { stderr: '', stdout: values.pnpm };
    }
    if (command === 'pnpm' && args.includes('tsc')) {
      return { stderr: '', stdout: values.tsc };
    }
    if (command === 'pnpm' && args.includes('tsx')) {
      return { stderr: '', stdout: values.tsx };
    }
    if (command === 'supabase') {
      return { stderr: '', stdout: values.supabase };
    }
    if (path.basename(command) === 'psql') {
      return { stderr: '', stdout: values.psql };
    }
    throw new Error('unexpected tool');
  };
}

describe('verifySupabaseReplayContract', () => {
  it('accepts only the frozen Task 3 toolchain', async () => {
    const contract = await verifySupabaseReplayContract({
      nodeVersion: outputs.node,
      psqlBin: '/custom/PostgreSQL-18.3/bin/psql',
      runCommand: commandWith(),
    });

    expect(contract).toEqual({
      nodeMajor: 24,
      psqlBin: '/custom/PostgreSQL-18.3/bin/psql',
      serverVersionNum: 170006,
    });
  });

  it('accepts the Ubuntu PostgreSQL 18.3 client suffix', async () => {
    const contract = await verifySupabaseReplayContract({
      nodeVersion: outputs.node,
      psqlBin: '/usr/bin/psql',
      runCommand: commandWith({
        psql: 'psql (PostgreSQL) 18.3 (Ubuntu 18.3-1.pgdg24.04+1)\n',
      }),
    });

    expect(contract).toEqual({
      nodeMajor: 24,
      psqlBin: '/usr/bin/psql',
      serverVersionNum: 170006,
    });
  });

  it.each([
    ['node', { node: '23.9.0' }],
    ['pnpm', { pnpm: '11.6.0\n' }],
    ['typescript', { tsc: 'Version 6.0.2\n' }],
    ['tsx', { tsx: 'tsx v4.22.3\nnode v24.11.1\n' }],
    ['tsx-node', { tsx: 'tsx v4.22.4\nnode v23.9.0\n' }],
    ['supabase', { supabase: '2.109.1\n' }],
    ['psql', { psql: 'psql (PostgreSQL) 17.6\n' }],
  ])('fails a %s mismatch without echoing observed output', async (tool, drift) => {
    const nodeVersion = 'node' in drift ? drift.node : outputs.node;

    await expect(
      verifySupabaseReplayContract({
        nodeVersion,
        psqlBin: '/secret/location/psql',
        runCommand: commandWith(drift),
      })
    ).rejects.toThrow(new RegExp(`^${tool} version mismatch$`));
  });
});

describe('createSupabaseReplayDatabaseEnvironment', () => {
  it('maps an owned loopback URL to bounded libpq variables', () => {
    expect(
      createSupabaseReplayDatabaseEnvironment(
        'postgresql://postgres:secret@127.0.0.1:6543/postgres',
        {
          KEEP_ME: 'yes',
          PGCONNECT_TIMEOUT: '99',
          PGHOSTADDR: '203.0.113.1',
          PGOPTIONS: '-c unsafe=on',
          PGSERVICE: 'external',
        }
      )
    ).toEqual({
      KEEP_ME: 'yes',
      PGCONNECT_TIMEOUT: '5',
      PGDATABASE: 'postgres',
      PGHOST: '127.0.0.1',
      PGPASSWORD: 'secret',
      PGPORT: '6543',
      PGUSER: 'postgres',
    });
  });

  it.each([
    'postgresql://postgres:secret@example.test:6543/postgres',
    'postgresql://postgres@127.0.0.1:6543/postgres',
  ])('rejects an unsupported database URL without echoing it', (databaseUrl) => {
    expect(() =>
      createSupabaseReplayDatabaseEnvironment(databaseUrl, {})
    ).toThrow(/^Supabase replay database URL is not supported$/);
  });
});

describe('Supabase replay loopback contract', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '127.42.9.8',
    '::1',
  ])('accepts %s', (host) => {
    expect(isSupabaseReplayLoopbackHost(host)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '128.0.0.1',
    'localhost.example',
    '::ffff:127.0.0.1',
  ])('rejects %s', (host) => {
    expect(isSupabaseReplayLoopbackHost(host)).toBe(false);
  });

  it('validates the owned database port without echoing credentials', () => {
    expect(() =>
      assertSupabaseReplayDatabaseUrl(
        'postgresql://postgres:secret@127.0.0.1:6543/postgres',
        6543
      )
    ).not.toThrow();
    expect(() =>
      assertSupabaseReplayDatabaseUrl(
        'postgresql://postgres:secret@example.com:6543/postgres',
        6543
      )
    ).toThrow(/^Supabase replay database URL is not owned loopback$/);
  });

  it('extracts one bounded database URL and discards other status values', async () => {
    const runCommand: ReplayCommand = async () => ({
      stderr: '',
      stdout:
        'ANON_KEY="secret"\nDB_URL="postgresql://postgres:secret@127.0.0.1:6543/postgres"\n',
    });

    await expect(
      readSupabaseReplayDatabaseUrl(runCommand, '/owned/replay')
    ).resolves.toBe('postgresql://postgres:secret@127.0.0.1:6543/postgres');
  });

  it('rejects oversized status output without echoing a credential', async () => {
    const credential = `postgresql://secret/${'x'.repeat(70_000)}`;
    const runCommand: ReplayCommand = async () => ({
      stderr: '',
      stdout: `DB_URL="${credential}"\n`,
    });

    await expect(
      readSupabaseReplayDatabaseUrl(runCommand, '/owned/replay')
    ).rejects.toThrow(/^Supabase replay status is invalid$/);
  });
});

describe('parseSupabaseReplayArguments', () => {
  it('requires explicit mode/state and collects repeatable checks', () => {
    expect(
      parseSupabaseReplayArguments([
        '--mode',
        'chronological',
        '--pending-repair-state',
        'materialized',
        '--sql-check',
        'one.sql',
        '--sql-check',
        'two.sql',
        '--types-output',
        'types.ts',
        '--receipt-output',
        'receipt.json',
      ])
    ).toEqual({
      comparisonMode: 'enforce',
      mode: 'chronological',
      pendingRepairState: 'materialized',
      productionOldCancellationProof: 'skip',
      receiptOutput: 'receipt.json',
      sqlChecks: ['one.sql', 'two.sql'],
      typesOutput: 'types.ts',
    });
    expect(
      parseSupabaseReplayArguments([
        '--mode',
        'production-effect',
        '--pending-repair-state',
        'materialized',
        '--comparison-mode',
        'classify',
        '--production-old-cancellation-proof',
        'required',
      ])
    ).toEqual({
      comparisonMode: 'classify',
      mode: 'production-effect',
      pendingRepairState: 'materialized',
      productionOldCancellationProof: 'required',
      sqlChecks: [],
    });
  });

  it.each(
    invalidArguments
  )('rejects an incomplete or unknown CLI contract', (argv) => {
    expect(() => parseSupabaseReplayArguments(argv)).toThrow(
      /^Invalid Supabase replay arguments$/
    );
  });
});

describe('readReplayCommandExecutionTimeoutMs', () => {
  it('defaults to five minutes when unset', () => {
    expect(readReplayCommandExecutionTimeoutMs({})).toBe(300_000);
  });

  it('reads a bounded timeout from the environment', () => {
    expect(
      readReplayCommandExecutionTimeoutMs({
        BACI_REPLAY_COMMAND_TIMEOUT_MS: '1800000',
      })
    ).toBe(1_800_000);
  });

  it('rejects invalid timeout values', () => {
    expect(() =>
      readReplayCommandExecutionTimeoutMs({
        BACI_REPLAY_COMMAND_TIMEOUT_MS: 'not-a-number',
      })
    ).toThrow(/^BACI_REPLAY_COMMAND_TIMEOUT_MS is invalid$/);
  });
});
