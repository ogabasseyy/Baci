import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectProductionImportClosure } from '@/lib/events/event-pipeline-import-closure';
import { eventPipelineSourceFilePolicy } from '../../tools/events/event-pipeline-source-file-policy';

function readFilesystemSources(root: string): Map<string, string> {
  const paths = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...eventPipelineSourceFilePolicy.pathspecs,
    ],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 }
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const sources = new Map<string, string>();
  for (const path of paths) {
    if (existsSync(join(root, path))) {
      sources.set(path, readFileSync(join(root, path), 'utf8'));
    }
  }
  return sources;
}

/**
 * The worker-host capture drain holds no service-role authority (R5). The
 * runtime suites spy on the service-client factories, but they mock the
 * primary dispatch, so this pins the guarantee on the real import graph:
 * nothing the CLI runs can reach a service-role or admin client factory or
 * the service credential authority.
 */
describe('capture drain CLI import graph', () => {
  it('cannot reach a service-role or admin client', () => {
    const root = resolve(process.cwd(), '../..');
    const sources = readFilesystemSources(root);
    const closure = collectProductionImportClosure(
      ['apps/web/src/scripts/piggyvest-webhook-capture-drain-cli.ts'],
      sources
    );
    // The real pipeline is in the closure, not a mock of it.
    for (const reached of [
      'apps/web/src/lib/piggyvest/webhook-capture-drain-runtime.ts',
      'apps/web/src/lib/piggyvest/webhook-capture-primary-replay.ts',
      'apps/web/src/lib/piggyvest/webhook-capture-legacy-replay.ts',
      'apps/web/src/lib/piggyvest/server-intake-client.ts',
      'apps/web/src/lib/piggyvest/webhook-intake-executor.ts',
      'apps/web/src/app/api/webhooks/piggyvest/primary-webhook-dispatch.ts',
    ])
      expect(closure.has(reached), reached).toBe(true);
    for (const forbidden of [
      'apps/web/src/lib/supabase/service.ts',
      'apps/web/src/lib/supabase/admin.ts',
      'apps/web/src/env.ts',
    ])
      expect(closure.has(forbidden), forbidden).toBe(false);

    // Prove that an injected forbidden edge would be detected too.
    const entry = 'apps/web/src/scripts/piggyvest-webhook-capture-drain-cli.ts';
    sources.set(entry, `${sources.get(entry)}\nimport '@/lib/supabase/service';`);
    expect(collectProductionImportClosure([entry], sources).has('apps/web/src/lib/supabase/service.ts')).toBe(true);
  }, 30_000);
});
