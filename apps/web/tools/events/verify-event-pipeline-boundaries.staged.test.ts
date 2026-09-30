import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyEventPipelineBoundaries as verifyProductionEventPipelineBoundaries } from './verify-event-pipeline-boundaries';

const roots: string[] = [];

function git(root: string, ...args: string[]) {
  execFileSync('git', args, { cwd: root });
}

function verifyEventPipelineBoundaries(
  root: string,
  frozenBaseSha: string,
  authorityByteBaseSha = frozenBaseSha
) {
  return verifyProductionEventPipelineBoundaries(
    root,
    frozenBaseSha,
    authorityByteBaseSha
  );
}

function repository(rogueSource = 'export const safe = true;\n'): {
  baseSha: string;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'event-verifier-stage-'));
  roots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'tests@example.com');
  git(root, 'config', 'user.name', 'Tests');
  const files = new Map([
    [
      'apps/web/tools/events/fixtures/event-pipeline-path-inventory.tsv',
      'seed\tapps/web/src/lib/events/rogue-factory.ts\n',
    ],
    ['apps/web/src/lib/events/rogue-factory.ts', rogueSource],
    ['apps/web/src/lib/inherited-admin.ts', "import '@/lib/supabase/admin';\n"],
    [
      'apps/web/src/app/api/payments/credit-direct/webhook/route.ts',
      "import { createServiceClient } from '@/lib/supabase/service';\n",
    ],
    [
      'apps/web/src/lib/supabase/admin.ts',
      'export const createAdminClient = () => null;\n',
    ],
    [
      'apps/web/src/lib/supabase/service.ts',
      'export const createServiceClient = () => null;\n',
    ],
  ]);
  for (const [path, source] of files) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'baseline');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return { baseSha, root };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

describe('event pipeline verifier staged source snapshot', () => {
  it('fails closed when the seed inventory receipt does not match', () => {
    const { baseSha, root } = repository();

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      'fixture: event-pipeline path inventory hash mismatch'
    );
  });

  it('rejects staged authority hidden by a clean unstaged worktree copy', () => {
    const { baseSha, root } = repository();
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    writeFileSync(
      join(root, path),
      "import { createServiceClient } from '@/lib/supabase/service';\n"
    );
    git(root, 'add', path);
    writeFileSync(join(root, path), 'export const safe = true;\n');

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: unauthorized service factory importer`
    );
  });

  it('rejects unstaged authority hidden by a safe staged copy', () => {
    const { baseSha, root } = repository();
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    writeFileSync(join(root, path), 'export const stagedSafe = true;\n');
    git(root, 'add', path);
    writeFileSync(
      join(root, path),
      "import { createServiceClient } from '@/lib/supabase/service';\n"
    );

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: unauthorized service factory importer`
    );
  });

  it('rejects the retired platform authority helper in the staged source view', () => {
    const { baseSha, root } = repository();
    const path =
      'apps/web/src/app/api/platform/events/platform-event-forwarding.ts';
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), 'export const forwarding = true;\n');
    git(root, 'add', path);
    writeFileSync(join(root, path), 'export const retired = true;\n');

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: retired platform authority helper is present`
    );
  });

  it('accepts identical frozen bytes for governed inherited authority', () => {
    const source =
      "import { createServiceClient } from '@/lib/supabase/service';\n";
    const { baseSha, root } = repository(source);
    const path = 'apps/web/src/lib/events/rogue-factory.ts';

    expect(verifyEventPipelineBoundaries(root, baseSha)).not.toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
  });

  it.each([
    ['whitespace/comment edit', '// formatting only\n'],
    ['destination move', 'left.send(createServiceClient);\n'],
    ['arbitrary flow mutation', 'if (enabled) createServiceClient();\n'],
  ])('rejects a governed inherited authority %s', (_, edit) => {
    const source =
      "import { createServiceClient } from '@/lib/supabase/service';\n";
    const { baseSha, root } = repository(source);
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    writeFileSync(join(root, path), `${source}${edit}`);

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
  });

  it('allows an inherited authority edit outside the production and seed envelope', () => {
    const { baseSha, root } = repository();
    const path = 'apps/web/src/app/api/payments/credit-direct/webhook/route.ts';
    const source =
      "import { createServiceClient } from '@/lib/supabase/service';\n";
    writeFileSync(join(root, path), `${source}// unrelated edit\n`);

    const findings = verifyEventPipelineBoundaries(root, baseSha);
    expect(findings).not.toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
    expect(findings).not.toContain(
      `${path}: unauthorized service factory importer`
    );
  });

  it('allows an unrelated non-authority edit inside the governed seed envelope', () => {
    const { baseSha, root } = repository();
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    writeFileSync(join(root, path), 'export const stillSafe = true;\n');

    const findings = verifyEventPipelineBoundaries(root, baseSha);
    expect(findings).not.toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
    expect(findings).not.toContain(
      `${path}: unauthorized service factory importer`
    );
  });

  it('enforces governed inherited-authority bytes from the staged view', () => {
    const source =
      "import { createServiceClient } from '@/lib/supabase/service';\n";
    const { baseSha, root } = repository(source);
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    writeFileSync(join(root, path), `${source}// staged edit\n`);
    git(root, 'add', path);
    writeFileSync(join(root, path), source);

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
  });

  it('enforces governed inherited-authority bytes from the filesystem view', () => {
    const source =
      "import { createServiceClient } from '@/lib/supabase/service';\n";
    const { baseSha, root } = repository(source);
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    git(root, 'update-index', '--chmod=+x', path);
    writeFileSync(join(root, path), `${source}// filesystem edit\n`);

    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
  });

  it('keeps a separate immutable authority-byte baseline after HEAD advances', () => {
    const source =
      "import { createServiceClient } from '@/lib/supabase/service';\n";
    const { baseSha, root } = repository(source);
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    const reviewed = `${source}// reviewed authority bytes\n`;
    writeFileSync(join(root, path), reviewed);
    git(root, 'add', path);
    git(root, 'commit', '--quiet', '-m', 'reviewed authority bytes');
    const authorityByteBaseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();

    expect(
      verifyEventPipelineBoundaries(root, baseSha, authorityByteBaseSha)
    ).not.toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );

    writeFileSync(join(root, path), `${reviewed}// later mutation\n`);
    git(root, 'add', path);
    git(root, 'commit', '--quiet', '-m', 'later mutation');
    expect(
      verifyEventPipelineBoundaries(root, baseSha, authorityByteBaseSha)
    ).toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
  });

  it('fails closed when the authority-byte baseline is unavailable', () => {
    const { baseSha, root } = repository();
    expect(
      verifyEventPipelineBoundaries(root, baseSha, 'missing-authority-base')
    ).toContain('frozen event-pipeline authority-byte snapshot is unavailable');
  });

  it('does not derive the authority-byte baseline from a supplied edge base', () => {
    const { baseSha, root } = repository();

    expect(verifyProductionEventPipelineBoundaries(root, baseSha)).toContain(
      'frozen event-pipeline authority-byte snapshot is unavailable'
    );
  });

  it('keeps the explicit frozen base after origin/main advances, then rejects untracked authority', () => {
    const { baseSha, root } = repository();
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    writeFileSync(
      join(root, path),
      "import { createServiceClient } from '@/lib/supabase/service';\n"
    );
    git(root, 'add', path);
    git(root, 'commit', '--quiet', '-m', 'committed authority');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(verifyEventPipelineBoundaries(root, baseSha)).toContain(
      `${path}: unauthorized service factory importer`
    );

    writeFileSync(join(root, path), 'export const safe = true;\n');
    const route = 'apps/web/src/app/api/new/route.ts';
    mkdirSync(join(root, route, '..'), { recursive: true });
    writeFileSync(
      route.startsWith('/') ? route : join(root, route),
      "import '@/lib/inherited-admin';\n"
    );
    expect(verifyEventPipelineBoundaries(root, baseSha).join('\n')).toContain(
      `${route} -> apps/web/src/lib/inherited-admin.ts -> apps/web/src/lib/supabase/admin.ts`
    );
  });

  it('keeps unrelated AST classification scoped but scans governed RPCs globally', () => {
    const { baseSha, root } = repository();
    const path = 'apps/web/src/unrelated/new-source.ts';
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(
      join(root, path),
      "client.from('merchants').select('bvn'); client.rpc('route_domain_event_v1', {});\n"
    );

    const findings = verifyEventPipelineBoundaries(root, baseSha);
    expect(findings).not.toContain(
      `${path}: unauthorized merchants column bvn`
    );
    expect(findings).toContain(
      `${path}: unauthorized direct RPC route_domain_event_v1`
    );
  });

  it('fails closed when the frozen base is unavailable', () => {
    const { root } = repository();
    expect(verifyEventPipelineBoundaries(root, 'missing-frozen-sha')).toContain(
      'frozen event-pipeline source snapshot is unavailable'
    );
  });
});
