import { execFile } from 'node:child_process';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { verifyHistoricalQuizReplay } from './historical-quiz-replay.test-support';
import { createReplayManifestTest } from './replay-manifest-test-case.test-support';
import { createReplayManifestTestWorkspace } from './replay-manifest-test-workspace.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';
import { verifySupabaseHistoryReplayManifest } from './verify-supabase-history-replay-manifest';

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = createReplayManifestTestWorkspace().workspaceRoot;
const spec = createReplayManifestTest();

describe('verifySupabaseHistoryReplayManifest', () => {
  spec(
    'keeps the historical quiz migration immutable and replay-transformable',
    () => verifyHistoricalQuizReplay(WORKSPACE_ROOT),
    90_000
  );

  spec(
    'verifies the frozen base without Docker, Supabase, or network I/O',
    async () => {
      const result = await verifySupabaseHistoryReplayManifest(WORKSPACE_ROOT, {
        pendingRepairState: 'materialized',
      });
      expect(result.pendingRepairState).toBe('materialized');
      expect(result.bootstrapSources).toHaveLength(125);
      expect(result.verifiedSources).toHaveLength(424);
      expect(result.postReplaySources).toHaveLength(12);
      expect(result.manifest.pendingSources).toHaveLength(
        EXPECTED_PENDING_SOURCES.length
      );
      expect(result.productionEffectProvenance.exceptionalRecords).toHaveLength(
        31
      );
    },
    90_000
  );

  spec('requires the explicit pending repair state at runtime', async () => {
    const invalidOptions = {};
    const verification = verifySupabaseHistoryReplayManifest(
      WORKSPACE_ROOT,
      // @ts-expect-error The public type requires the discriminant; runtime still fails closed.
      invalidOptions
    );
    await expect(verification).rejects.toThrow(
      'pendingRepairState must be explicit'
    );
  });

  spec(
    'rejects a present repair in not-materialized mode',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await writeFile(
        path.join(
          root,
          'supabase/migrations/20260714225501_reconcile_order_fulfillment_timestamps.sql'
        ),
        'unexpected bytes\n'
      );
      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'not-materialized',
        })
      ).rejects.toThrow('must be absent');
    }
  );

  spec(
    'requires exact repair bytes in materialized mode',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      const repairPath = path.join(
        root,
        'supabase/migrations/20260714225501_reconcile_order_fulfillment_timestamps.sql'
      );
      await writeFile(repairPath, 'unexpected bytes\n');
      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow('repair SHA-256');
    }
  );

  spec(
    'rejects materialized mode when the repair is absent',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await rm(path.join(root, supabaseHistoryReplayManifest.repair.path));

      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow('must exist');
    }
  );

  spec(
    'accepts materialized mode only with the exact repair body',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await writeFile(
        path.join(root, supabaseHistoryReplayManifest.repair.path),
        supabaseHistoryReplayManifest.repair.body
      );

      const result = await verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      });

      expect(result.pendingRepairState).toBe('materialized');
      expect(result.verifiedSources).toHaveLength(424);
    },
    90_000
  );

  spec(
    'requires every ordered forward repair to exist',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await rm(
        path.join(root, supabaseHistoryReplayManifest.forwardRepairs[0].path)
      );

      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow('Forward repair must exist');
    },
    90_000
  );

  spec(
    'requires exact forward-repair bytes',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await writeFile(
        path.join(root, supabaseHistoryReplayManifest.forwardRepairs[1].path),
        'unexpected bytes\n'
      );

      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow('Forward repair SHA-256');
    },
    90_000
  );

  spec(
    'requires exact post-replay source bytes',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await writeFile(
        path.join(
          root,
          supabaseHistoryReplayManifest.postReplaySources[1].repositoryPath
        ),
        'unexpected bytes\n'
      );

      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow(/post-replay.*SHA-256/i);
    },
    90_000
  );

  spec(
    'rejects current-tree migration drift from the frozen base',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      const source = path.join(
        root,
        'supabase/migrations/20260712150001_domain_event_pipeline_tables.sql'
      );
      await writeFile(source, `${await readFile(source, 'utf8')}\n-- drift\n`);
      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow(/current-tree source drift/i);
    },
    90_000
  );

  spec(
    'rejects an extra SQL symlink in the migration registry',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      await symlink(
        '20260712150001_domain_event_pipeline_tables.sql',
        path.join(root, 'supabase/migrations/20990101000000_extra.sql')
      );

      await expect(
        verifySupabaseHistoryReplayManifest(root, {
          pendingRepairState: 'materialized',
        })
      ).rejects.toThrow(/migration registry differs/i);
    },
    90_000
  );

  spec('rejects canonical provenance drift', async (copyWorkspace) => {
    const root = await copyWorkspace();
    const fixture = path.join(
      root,
      'apps/web/tools/db/fixtures/production-effect-provenance.json'
    );
    await writeFile(
      fixture,
      (await readFile(fixture, 'utf8')).replace(
        'partial-order-effect-replay',
        'drift'
      )
    );
    await expect(
      verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      })
    ).rejects.toThrow(/provenance|canonical/i);
  });

  spec(
    'ignores replacement refs when enumerating the frozen base',
    async (copyWorkspace) => {
      const root = await copyWorkspace();
      const emptyTreeFixture = path.join(root, 'empty-tree');
      await writeFile(emptyTreeFixture, '');
      const { stdout: emptyTree } = await execFileAsync('git', [
        '-C',
        root,
        'hash-object',
        '-t',
        'tree',
        '-w',
        emptyTreeFixture,
      ]);
      const { stdout: replacementCommit } = await execFileAsync('git', [
        '-C',
        root,
        '-c',
        'user.name=Baci Test',
        '-c',
        'user.email=test@usebaci.com',
        'commit-tree',
        emptyTree.trim(),
        '-m',
        'replacement',
      ]);
      await execFileAsync('git', [
        '-C',
        root,
        'replace',
        supabaseHistoryReplayManifest.baseSha,
        replacementCommit.trim(),
      ]);

      const result = await verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      });

      expect(result.verifiedSources).toHaveLength(424);
    },
    90_000
  );

  spec(
    'uses argv-safe git calls for workspace paths containing shell metacharacters',
    async (copyWorkspace) => {
      const root = await copyWorkspace('baci-replay;touch SHOULD_NOT_EXIST;');
      const result = await verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      });
      expect(result.verifiedSources).toHaveLength(424);
      await expect(
        readFile(path.join(root, 'SHOULD_NOT_EXIST'))
      ).rejects.toThrow();
    },
    90_000
  );
});
