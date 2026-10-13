import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eventPipelineGovernedPaths } from './event-pipeline-governed-paths';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe('eventPipelineGovernedPaths', () => {
  it('loads the frozen seed inventory and current source inventory safely', () => {
    const governed = eventPipelineGovernedPaths.collect();
    expect(governed.fixtureRecordCount).toBe(154);
    expect(governed.fixtureInventorySha256).toBe(
      '8a0f0b5e61d39fe46144e0114a41c7e25a8501e756ce1b819cca5fb793c6d0dc'
    );
    expect(governed.fixtureInventoryHashMatches).toBe(true);
    expect(governed.paths).toContain(
      'apps/web/tools/events/event-pipeline-governed-paths.ts'
    );
    expect(governed.productionPaths).toContain(
      'apps/web/src/scripts/process-event-deliveries.ts'
    );
    expect(governed.seedPaths).toContain('apps/web/src/app/checkout/page.tsx');
    expect(governed.missingProductionRoots).toEqual([]);
  });

  it('pins the authority-byte baseline to a reachable landing ancestor', () => {
    const root = eventPipelineGovernedPaths.repoRoot();
    const reviewedSha = 'cc3557aa5556db17131b0b66f72087e10794791b';

    expect(eventPipelineGovernedPaths.authorityByteBaseSha).toBe(reviewedSha);
    expect(
      execFileSync('git', ['cat-file', '-t', reviewedSha], {
        cwd: root,
        encoding: 'utf8',
      }).trim()
    ).toBe('commit');
    expect(() =>
      execFileSync(
        'git',
        ['merge-base', '--is-ancestor', reviewedSha, 'HEAD'],
        {
          cwd: root,
        }
      )
    ).not.toThrow();
  });

  it('discovers every supported JavaScript and TypeScript source extension', () => {
    const root = mkdtempSync(join(tmpdir(), 'event-source-paths-'));
    directories.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const paths = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].map(
      (extension) => `authority.${extension}`
    );
    for (const path of paths) writeFileSync(join(root, path), 'export {};');

    expect(eventPipelineGovernedPaths.sourcePaths(root).sort()).toEqual(
      paths.sort()
    );
  });

  it('rejects a substituted seed inventory even when its record count is unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'event-seed-receipt-'));
    directories.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const fixtureDirectory = join(root, 'apps/web/tools/events/fixtures');
    mkdirSync(fixtureDirectory, { recursive: true });
    writeFileSync(
      join(fixtureDirectory, 'event-pipeline-path-inventory.tsv'),
      'seed\tapps/web/src/substituted.ts\n'
    );
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });
    const frozenBase = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();

    const governed = eventPipelineGovernedPaths.collect(
      root,
      new Map(),
      frozenBase
    );
    expect(governed.fixtureRecordCount).toBe(1);
    expect(governed.fixtureInventoryHashMatches).toBe(false);
  });

  it('rejects a staged inventory substitution hidden by clean filesystem bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'event-seed-index-receipt-'));
    directories.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: root });
    const fixturePath =
      'apps/web/tools/events/fixtures/event-pipeline-path-inventory.tsv';
    const fixtureSource = readFileSync(
      join(eventPipelineGovernedPaths.repoRoot(), fixturePath),
      'utf8'
    );
    mkdirSync(join(root, fixturePath, '..'), { recursive: true });
    writeFileSync(join(root, fixturePath), fixtureSource);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });
    const frozenBase = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    writeFileSync(
      join(root, fixturePath),
      fixtureSource.replace('\t', '\tsubstituted-')
    );
    execFileSync('git', ['add', fixturePath], { cwd: root });
    writeFileSync(join(root, fixturePath), fixtureSource);

    expect(
      eventPipelineGovernedPaths.collect(root, new Map(), frozenBase)
        .fixtureInventoryHashMatches
    ).toBe(false);
  });

  it('preserves newline-bearing source paths from every Git inventory', () => {
    const root = mkdtempSync(join(tmpdir(), 'event-governed-paths-'));
    directories.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: root });
    const fixtureDirectory = join(root, 'apps/web/tools/events/fixtures');
    mkdirSync(fixtureDirectory, { recursive: true });
    writeFileSync(
      join(fixtureDirectory, 'event-pipeline-path-inventory.tsv'),
      'seed\tapps/web/src/root.ts\n'
    );
    writeFileSync(join(root, 'baseline.ts'), 'export {};');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });
    const frozenBase = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
      cwd: root,
    });
    const path = 'apps/web/src/line\nbreak.ts';
    mkdirSync(join(root, 'apps/web/src'), { recursive: true });
    writeFileSync(join(root, path), 'export {};');

    expect(eventPipelineGovernedPaths.sourcePaths(root)).toContain(path);
    expect(
      eventPipelineGovernedPaths.collect(root, new Map(), frozenBase).paths
    ).toContain(path);
  });

  it('discovers committed paths from the frozen base instead of origin/main', () => {
    const root = mkdtempSync(join(tmpdir(), 'event-frozen-base-paths-'));
    directories.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: root });
    const fixtureDirectory = join(root, 'apps/web/tools/events/fixtures');
    mkdirSync(fixtureDirectory, { recursive: true });
    writeFileSync(
      join(fixtureDirectory, 'event-pipeline-path-inventory.tsv'),
      'seed\tapps/web/src/root.ts\n'
    );
    writeFileSync(join(root, 'baseline.ts'), 'export {};');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'frozen base'], {
      cwd: root,
    });
    const frozenBase = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const governedTool = 'apps/web/tools/events/governed-tool.ts';
    writeFileSync(
      join(root, governedTool),
      'export const governedTool = true;'
    );
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'task tool'], {
      cwd: root,
    });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
      cwd: root,
    });

    const governed = eventPipelineGovernedPaths.collect(
      root,
      new Map(),
      frozenBase
    );

    expect(governed.changedPaths).toContain(governedTool);
    expect(governed.paths).toContain(governedTool);
    expect(governed.productionPaths).not.toContain(governedTool);
  });
});
