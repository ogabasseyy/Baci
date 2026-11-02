import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectProductionImportClosure } from '@/lib/events/event-pipeline-import-closure';
import { readGitSourceSnapshot } from '../../tools/events/event-pipeline-git-source-snapshot';

/**
 * The worker-host capture drain holds no service-role authority (R5). The
 * runtime suites spy on the service-client factories, but they mock the
 * primary dispatch, so this pins the guarantee on the real import graph:
 * nothing the CLI runs can reach a service-role or admin client factory or
 * the service credential authority.
 */
describe('capture drain CLI import graph', () => {
  // Reading the repository snapshot is slow on a busy machine.
  it('cannot reach a service-role or admin client', { timeout: 60_000 }, () => {
    const root = resolve(process.cwd(), '../..');
    const sources = readGitSourceSnapshot(root).filesystemSources;
    const closure = collectProductionImportClosure(
      ['apps/web/src/scripts/piggyvest-webhook-capture-drain-cli.ts'],
      sources
    );
    // The real pipeline is in the closure, not a mock of it.
    for (const reached of [
      'apps/web/src/lib/piggyvest/webhook-capture-drain-runtime.ts',
      'apps/web/src/lib/piggyvest/webhook-capture-primary-replay.ts',
      'apps/web/src/app/api/webhooks/piggyvest/primary-webhook-dispatch.ts',
    ])
      expect(closure.has(reached), reached).toBe(true);
    for (const forbidden of [
      'apps/web/src/lib/supabase/service.ts',
      'apps/web/src/lib/supabase/admin.ts',
      'apps/web/src/lib/piggyvest/server-intake-client.ts',
      'apps/web/src/env.ts',
    ])
      expect(closure.has(forbidden), forbidden).toBe(false);
  });
});
