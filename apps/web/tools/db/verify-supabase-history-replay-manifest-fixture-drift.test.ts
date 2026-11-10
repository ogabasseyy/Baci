import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it as vitestIt } from 'vitest';
import { createReplayManifestTestWorkspace } from './replay-manifest-test-workspace.test-support';
import { verifySupabaseHistoryReplayManifest } from './verify-supabase-history-replay-manifest';

// Each test owns its workspace even if a timed-out cleanup is still running.
const it = (
  name: string,
  operation: (
    copyWorkspace: (prefix?: string) => Promise<string>
  ) => Promise<void>,
  timeout = 90_000
) =>
  vitestIt(
    name,
    async ({ onTestFinished }) => {
      const workspace = createReplayManifestTestWorkspace();
      onTestFinished(async () => {
        await workspace.cleanUp();
      }, 120_000);
      await workspace.run(() =>
        operation((prefix) =>
          workspace.copyWorkspace(prefix ?? 'baci-replay-drift-')
        )
      );
    },
    timeout
  );

describe('post-deploy replay fixture drift', () => {
  it('rejects refreshed production-effect fixture byte drift', async (copyWorkspace) => {
    const root = await copyWorkspace();
    const fixture = path.join(
      root,
      'apps/web/tools/db/fixtures/production-history-effects.json'
    );
    await writeFile(
      fixture,
      (await readFile(fixture, 'utf8')).replace(
        '71cba5629959c75352726e26cafcbfec8de99b1b52d10e6ad70fd85f07e4d253',
        '0'.repeat(64)
      )
    );

    await expect(
      verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      })
    ).rejects.toThrow(/production-effect fixture/i);
  });

  it('rejects refreshed linked-ledger fixture byte drift', async (copyWorkspace) => {
    const root = await copyWorkspace();
    const fixture = path.join(
      root,
      'apps/web/tools/db/fixtures/linked-migration-ledger.json'
    );
    await writeFile(
      fixture,
      (await readFile(fixture, 'utf8')).replace(
        '20260714225503',
        '20260714225504'
      )
    );

    await expect(
      verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      })
    ).rejects.toThrow(/linked-ledger fixture/i);
  });
});
