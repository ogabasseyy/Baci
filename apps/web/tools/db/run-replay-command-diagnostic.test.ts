import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySupabaseReplaySql } from './apply-supabase-replay-sql';
import { replayCommandRuntime } from './run-replay-command';
import { runSupabaseReplayStage } from './run-supabase-replay-stage';

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});
async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'baci-replay-diag-'));
  temporaryRoots.push(root);
  return root;
}

describe('replay diagnostics', () => {
  it('reports a startup milestone from a failed subprocess without leaking adjacent secrets', async () => {
    const root = await temporaryRoot();
    const supabase = path.join(root, 'supabase');
    const secret = 'password=synthetic-private-value';
    const stderr = `Starting database...\nInitialising schema...\n${secret}\n`;
    await writeFile(
      supabase,
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr)});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const run = replayCommandRuntime.create(root);
    const error = await runSupabaseReplayStage('db start', () =>
      run(supabase, ['db', 'start'])
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Supabase replay stage db start failed (supabase failed: non-zero-exit (diagnostic=startup-schema))'
    );
    expect((error as Error).message).not.toContain(secret);
  });

  it('skips an explicitly confirmed expected denial and reports the later failure', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    const stderr =
      'psql:/private.sql:87: ERROR:  42501: expected private denial\npsql:/private.sql:105: ERROR:  P1004: later private failure\n';
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stdout.write('OXYGEN_ANON_DRAFT_DENIAL_OK\\n');process.stderr.write(${JSON.stringify(stderr)});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const run = replayCommandRuntime.create(root);
    await expect(
      applySupabaseReplaySql(() => run(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 189: non-zero-exit \(line=105,sqlstate=P1004\)$/
    );
  });

  it('does not report a confirmed expected denial if the connection later fails', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stdout.write('OXYGEN_ANON_DRAFT_DENIAL_OK\\n');process.stderr.write('psql:/private.sql:87: ERROR:  42501: expected private denial\\n');process.exit(2);\n`,
      { mode: 0o700 }
    );
    const run = replayCommandRuntime.create(root);
    await expect(
      applySupabaseReplaySql(() => run(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 189: non-zero-exit$/
    );
  });
  it.each([
    1, 2, 3, 7,
  ])('reports only a bounded psql exit category for exit %i', async (exit) => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stderr.write('psql:/private.sql:89: ERROR: private value\\n');process.exit(${exit});\n`,
      { mode: 0o700 }
    );
    const run = replayCommandRuntime.create(root);
    const expected = exit <= 3 ? exit : 0;
    await expect(
      applySupabaseReplaySql(() => run(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      `Replay SQL check failed at ordinal 189: non-zero-exit (line=89,shape=0000,exit=${expected})`
    );
  });
  it('recovers only the fixed SQLSTATE from stdout without leaking values', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    const stdout =
      'private value\nOXYGEN_ANON_DRAFT_POST_DO\nOXYGEN_ANON_DRAFT_SQLSTATE 42883\n';
    const stderr = 'psql:/private.sql:89: ERROR: private error\n';
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const run = replayCommandRuntime.create(root);
    await expect(
      applySupabaseReplaySql(() => run(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 189: non-zero-exit \(line=89,sqlstate=42883\)$/
    );
  });

  it('reports continuation without exposing stdout when no state marker exists', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stdout.write('OXYGEN_ANON_DRAFT_POST_DO\\nprivate');process.stderr.write('psql:/private.sql:89: ERROR: private\\n');process.exit(1);\n`,
      { mode: 0o700 }
    );
    const run = replayCommandRuntime.create(root);
    await expect(
      applySupabaseReplaySql(() => run(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 189: non-zero-exit \(line=89,shape=0000,checkpoint=1,exit=1\)$/
    );
  });

  it('reports only fixed shape bits through the complete replay error pipeline', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify('psql:/private.sql:88: ERROR:\n  42501: private identity and secret\n')});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    await expect(
      applySupabaseReplaySql(() => runCommand(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 189: non-zero-exit \(line=88,shape=1001,exit=1\)$/
    );
  });

  it('recovers the captured state from a later fixed psql diagnostic without leaking errors', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    const stderr =
      'psql:/private.sql:88: ERROR: private error with identity\n' +
      'psql:/private.sql:99: ERROR: OXYGEN_ANON_DRAFT_SQLSTATE=42883\n';
    await writeFile(
      psql,
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr)});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    await expect(
      applySupabaseReplaySql(() => runCommand(psql, []), {
        kind: 'sql-check',
        ordinal: 189,
        sqlPath: '/private.sql',
      })
    ).rejects.toThrow(
      /^Replay SQL check failed at ordinal 189: non-zero-exit \(line=88,sqlstate=42883\)$/
    );
  });
});
