import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eventPipelineStaticModuleGraph } from './event-pipeline-static-module-graph';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('read-only catalog agent authority', () => {
  it('cannot import the checkout tool runtime or its signing authority', () => {
    const paths = execFileSync(
      'git',
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        'apps/web/src',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    )
      .split('\0')
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path));
    const sources = new Map(
      paths.map((path) => [
        path,
        readFileSync(resolve(repositoryRoot, path), 'utf8'),
      ])
    );
    const root = 'apps/web/src/app/api/chat/ogabassey-catalog-agent.ts';
    const authority = new Set([
      'apps/web/src/app/api/chat/chat-tool-runtime.ts',
      'apps/web/src/ai/chat-order-cancellation.ts',
      'apps/web/src/lib/agentic/scoped-supabase.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
    ]);

    expect(
      eventPipelineStaticModuleGraph.importPaths(root, authority, sources)
    ).toEqual(new Map());
  });
});
