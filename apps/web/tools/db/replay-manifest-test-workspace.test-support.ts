import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const execFileAsync = promisify(execFile);

export function createReplayManifestTestWorkspace(
  removeRoot = (root: string) =>
    rm(root, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
) {
  const temporaryRoots: string[] = [];
  const pendingOperations = new Set<Promise<unknown>>();

  return {
    workspaceRoot: WORKSPACE_ROOT,
    run: <T>(operation: () => Promise<T>) => {
      const pending = Promise.resolve().then(operation);
      pendingOperations.add(pending);
      void pending.then(
        () => pendingOperations.delete(pending),
        () => pendingOperations.delete(pending)
      );
      return pending;
    },
    copyWorkspace: async (prefix = 'baci-replay-verifier-') => {
      const root = await mkdtemp(path.join(tmpdir(), prefix));
      temporaryRoots.push(root);
      await execFileAsync('git', [
        'clone',
        '--shared',
        '--no-checkout',
        WORKSPACE_ROOT,
        root,
      ]);
      await cp(
        path.join(WORKSPACE_ROOT, 'supabase/migrations'),
        path.join(root, 'supabase/migrations'),
        { recursive: true }
      );
      await cp(
        path.join(WORKSPACE_ROOT, 'supabase/tests/migration_history_overlays'),
        path.join(root, 'supabase/tests/migration_history_overlays'),
        { recursive: true }
      );
      await cp(
        path.join(WORKSPACE_ROOT, 'apps/web/tools/db/fixtures'),
        path.join(root, 'apps/web/tools/db/fixtures'),
        { recursive: true }
      );
      return root;
    },
    cleanUp: async () => {
      await Promise.allSettled([...pendingOperations]);
      const roots = temporaryRoots.splice(0);
      const results = await Promise.allSettled(
        roots.map(async (root) => removeRoot(root))
      );
      const failures = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [];
        temporaryRoots.push(roots[index]);
        return [result.reason];
      });
      if (failures.length > 0) throw failures[0];
    },
  };
}
