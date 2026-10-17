import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runSupabaseHistoryReplay } from './run-supabase-history-replay';
import { createSupabaseReplayRuntimeFixture } from './run-supabase-history-replay-test-runtime';

describe('runSupabaseHistoryReplay', () => {
  it('runs the exact owned replay lifecycle and retries a pre-start port race', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    const receipt = await runSupabaseHistoryReplay(
      {
        comparisonMode: 'enforce',
        mode: 'chronological',
        pendingRepairState: 'materialized',
        productionOldCancellationProof: 'skip',
        receiptOutput: 'docs/receipt.json',
        repositoryRoot: fixture.root,
        sqlChecks: ['supabase/tests/one.sql', 'supabase/tests/two.sql'],
        typesOutput: 'apps/web/src/types/supabase.ts',
      },
      fixture.deps
    );

    expect(fixture.copies).toHaveLength(125);
    expect(fixture.deps.allocatePorts).toHaveBeenCalledTimes(2);
    expect(fixture.replacements).toEqual([
      path.join(fixture.workdir, 'supabase/config.toml'),
      path.join(fixture.workdir, 'supabase/config.toml'),
      path.join(fixture.workdir, '.baci-supabase-replay-owner.json'),
      path.join(fixture.root, 'apps/web/src/types/supabase.ts'),
    ]);
    expect(fixture.commands).toEqual([
      'docker info',
      `supabase init --workdir ${fixture.workdir}`,
      `supabase db start --workdir ${fixture.workdir}`,
      `supabase migration up --local --workdir ${fixture.workdir}`,
      `supabase status --workdir ${fixture.workdir} -o env`,
      'psql -X -w -v ON_ERROR_STOP=1 -At',
      `psql -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f ${fixture.workdir}/sql/126-00000000000126_migration.sql`,
      `psql -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f ${fixture.workdir}/sql/127-00000000000127_migration.sql`,
      `psql -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f ${fixture.root}/supabase/tests/one.sql`,
      `psql -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f ${fixture.root}/supabase/tests/two.sql`,
      'psql -X -w -At -c SHOW server_version_num',
      `supabase gen types typescript --db-url ${fixture.databaseUrl} --schema public`,
      'read ownership',
      `supabase stop --no-backup --workdir ${fixture.workdir}`,
    ]);
    expect(
      fixture.commands.some((command) => command.includes('db reset'))
    ).toBe(false);
    expect(receipt).toMatchObject({
      baseSha: 'base-sha',
      comparison: {
        changedComponents: [],
        converged: true,
        mode: 'enforce',
      },
      effectSha256: 'effect-sha',
      mode: 'chronological',
      serverVersionNum: 170006,
      sqlChecks: ['supabase/tests/one.sql', 'supabase/tests/two.sql'],
    });
    expect(receipt.orderedSources).toHaveLength(127);
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0]?.path).toBe(
      path.join(fixture.root, 'docs/receipt.json')
    );
    expect(fixture.writes[0]?.bytes).not.toContain(fixture.databaseUrl);
    expect(fixture.deps.output).toHaveBeenCalledTimes(2);
    expect(fixture.removed).toEqual([fixture.workdir]);
  });

  it('applies the verified current-tree suffix after effects and before checks and types', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    const verified = await fixture.deps.verifyManifest(fixture.root, {
      pendingRepairState: 'materialized',
    });
    fixture.deps.verifyManifest = vi.fn(async () => ({
      ...verified,
      manifest: {
        ...verified.manifest,
        pendingSources: [
          {
            repositoryPath: 'supabase/migrations/00000000000129_pending.sql',
            sha256: '9'.repeat(64),
          },
        ],
      },
      postReplaySources: [
        {
          receiptId: 'post-replay:supabase/migrations/00000000000128_post.sql',
          repositoryPath: 'supabase/migrations/00000000000128_post.sql',
          sha256: '8'.repeat(64),
        },
      ],
    }));
    const stages: string[] = [];
    const verifyEffects = fixture.deps.verifyEffects;
    fixture.deps.verifyEffects = vi.fn(async (options) => {
      stages.push('effects');
      return verifyEffects(options);
    });
    const createCommand = fixture.deps.createCommand;
    fixture.deps.createCommand = (root) => {
      const run = createCommand(root);
      return async (command, args, options) => {
        const invocation = args.join(' ');
        if (invocation.includes('00000000000128_post.sql')) stages.push('post');
        if (invocation.includes('00000000000129_pending.sql'))
          stages.push('pending');
        if (invocation.includes('supabase/tests/current.sql'))
          stages.push('check');
        if (command === 'supabase' && args.includes('gen'))
          stages.push('types');
        return run(command, args, options);
      };
    };

    await runSupabaseHistoryReplay(
      {
        ...fixture.replayOptions(),
        sqlChecks: ['supabase/tests/current.sql'],
        typesOutput: 'apps/web/src/types/supabase.ts',
      },
      fixture.deps
    );

    expect(stages).toEqual(['effects', 'post', 'pending', 'check', 'types']);
  });

  it('cleans up without applying replay SQL when migration-up fails', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    const baseCommand = fixture.deps.createCommand(fixture.root);
    fixture.deps.createCommand = () => async (command, args, options) => {
      if (
        command === 'supabase' &&
        args[0] === 'migration' &&
        args[1] === 'up'
      ) {
        fixture.commands.push(`${path.basename(command)} ${args.join(' ')}`);
        throw new Error('supabase failed: non-zero-exit');
      }
      return baseCommand(command, args, options);
    };

    await expect(
      runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps)
    ).rejects.toThrow(
      /^Supabase replay stage migration up failed \(supabase failed: non-zero-exit\)$/
    );

    expect(fixture.commands).not.toContain(
      `supabase status --workdir ${fixture.workdir} -o env`
    );
    expect(fixture.commands.some((command) => command.includes(' -f '))).toBe(
      false
    );
    expect(fixture.commands).toContain(
      `supabase stop --no-backup --workdir ${fixture.workdir}`
    );
    expect(fixture.writes).toEqual([]);
    expect(fixture.removed).toEqual([fixture.workdir]);
  });

  it('cleans up before source 126 when bootstrap history is not exact', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.verifyBootstrapHistory = vi.fn(async () => {
      throw new Error('Supabase replay bootstrap history mismatch');
    });

    const failure = await runSupabaseHistoryReplay(
      fixture.replayOptions(),
      fixture.deps
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'Supabase replay bootstrap history mismatch',
    });
    expect((failure as Error).message).not.toContain(fixture.databaseUrl);
    expect(fixture.commands.some((command) => command.includes(' -f '))).toBe(
      false
    );
    expect(fixture.deps.verifyEffects).not.toHaveBeenCalled();
    expect(fixture.commands).toContain(
      `supabase stop --no-backup --workdir ${fixture.workdir}`
    );
    expect(fixture.writes).toEqual([]);
    expect(fixture.removed).toEqual([fixture.workdir]);
  });

  it('revalidates ownership before stopping after a partial start failure', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.createCommand = () => async (command, args) => {
      fixture.commands.push(`${path.basename(command)} ${args.join(' ')}`);
      if (command === 'supabase' && args[0] === 'db' && args[1] === 'start') {
        throw new Error('supabase failed: non-zero-exit');
      }
      return { stderr: '', stdout: '' };
    };

    await expect(
      runSupabaseHistoryReplay(
        fixture.replayOptions('production-effect'),
        fixture.deps
      )
    ).rejects.toThrow(
      /^Supabase replay stage db start failed \(supabase failed: non-zero-exit\)$/
    );

    expect(fixture.commands).toContain(
      `supabase stop --no-backup --workdir ${fixture.workdir}`
    );
    expect(fixture.commands.indexOf('read ownership')).toBe(
      fixture.commands.indexOf(
        `supabase stop --no-backup --workdir ${fixture.workdir}`
      ) - 1
    );
    expect(fixture.removed).toEqual([fixture.workdir]);
  });

  it('preserves a start timeout as primary when cleanup only has readiness diagnostics', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    const operationalFailure = new Error('supabase failed: timeout');
    fixture.deps.createCommand = () => async (command, args) => {
      fixture.commands.push(`${path.basename(command)} ${args.join(' ')}`);
      if (command === 'supabase' && args[0] === 'db' && args[1] === 'start') {
        throw operationalFailure;
      }
      return { stderr: '', stdout: '' };
    };
    fixture.deps.stopOwnedProject = vi.fn(async () => ({
      resourceReadiness: 'anomalous' as const,
    }));

    const failure = await runSupabaseHistoryReplay(
      fixture.replayOptions('production-effect'),
      fixture.deps
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message:
        'Supabase replay stage db start failed (supabase failed: timeout)',
      replayDiagnostics: {
        cleanup: { resourceReadiness: 'anomalous' },
      },
    });
    expect((failure as Error).cause).toMatchObject({
      message:
        'Supabase replay stage db start failed (supabase failed: timeout)',
    });
    expect(fixture.removed).toEqual([fixture.workdir]);
  });

  it('refuses to stop when the on-disk ownership marker is invalid', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.stopOwnedProject = vi.fn(async () => {
      throw new Error('Invalid replay ownership marker');
    });

    await expect(
      runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps)
    ).rejects.toThrow(/^Supabase replay cleanup failed$/);
    expect(
      fixture.commands.some((command) => command.startsWith('supabase stop'))
    ).toBe(false);
    expect(fixture.removed).toEqual([]);
  });

  it.each([
    'supabase stop failed',
    'Supabase replay resources remain after stop',
  ])('retains the owned workdir when cleanup fails: %s', async (message) => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.stopOwnedProject = vi.fn(async () => {
      throw new Error(message);
    });

    await expect(
      runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps)
    ).rejects.toThrow(/^Supabase replay cleanup failed$/);
    expect(fixture.removed).toEqual([]);
  });

  it('rejects oversized secret-bearing status output without retaining it', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    const secret = `postgresql://postgres:secret@127.0.0.1:41001/${'x'.repeat(70_000)}`;
    const baseCommand = fixture.deps.createCommand(fixture.root);
    fixture.deps.createCommand = () => async (command, args, options) =>
      command === 'supabase' && args.includes('status')
        ? { stderr: '', stdout: `DB_URL="${secret}"\n` }
        : baseCommand(command, args, options);

    await expect(
      runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps)
    ).rejects.toThrow(/^Supabase replay stage status failed$/);
    expect(fixture.writes).toEqual([]);
  });
});
