import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { privilegedCallerAnalysis } from './agentic-dva-caller-contract-test-support';
import { collectDvaSourceFiles } from './agentic-dva-caller-source-files.test-support';

const roots: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'dva-source-inventory-'));
  roots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'tests@example.com');
  git(root, 'config', 'user.name', 'Tests');
  return root;
}

function writeSource(root: string, path: string, source: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

describe('collectDvaSourceFiles', () => {
  it('includes tracked ignored-directory source and untracked callers, but excludes ignored reports', () => {
    const root = repository();
    writeFileSync(join(root, '.gitignore'), '.superpowers/\nreports/\n');
    const definitionPath =
      'apps/web/src/lib/agentic/checkout-payment-account.ts';
    const trackedIgnoredPath = 'apps/web/.superpowers/review/artifact.ts';
    const untrackedCallerPath = 'apps/web/src/lib/agentic/untracked-caller.ts';
    const ignoredReportPath = 'reports/generated-report.ts';
    writeSource(
      root,
      definitionPath,
      'export function createAgenticCheckoutPaymentAccount() {}\n'
    );
    writeSource(root, trackedIgnoredPath, 'export const tracked = true;\n');
    writeSource(
      root,
      untrackedCallerPath,
      "import { createAgenticCheckoutPaymentAccount } from './checkout-payment-account';\ncreateAgenticCheckoutPaymentAccount();\n"
    );
    writeSource(root, ignoredReportPath, 'export const generated = true;\n');
    git(root, 'add', '.gitignore', definitionPath);
    git(root, 'add', '-f', trackedIgnoredPath);

    const files = collectDvaSourceFiles(root);
    const paths = files.map(({ path }) => path);
    expect(paths).toContain(definitionPath);
    expect(paths).toContain(trackedIgnoredPath);
    expect(paths).toContain(untrackedCallerPath);
    expect(paths).not.toContain(ignoredReportPath);

    const sourcesByPath = new Map(
      files.map((file) => [file.path, file.source])
    );
    const caller = files.find(({ path }) => path === untrackedCallerPath);
    expect(caller).toBeDefined();
    if (!caller) throw new Error('untracked_caller_missing');
    expect(
      privilegedCallerAnalysis.countCalls({
        definitionPath,
        file: caller,
        functionName: 'createAgenticCheckoutPaymentAccount',
        sourcesByPath,
      })
    ).toBe(1);
  });

  it('skips tracked source files deleted from the worktree', () => {
    const root = repository();
    const deletedPath = 'apps/web/src/lib/agentic/deleted-caller.ts';
    writeSource(root, deletedPath, 'export const removed = true;\n');
    git(root, 'add', deletedPath);
    git(root, 'commit', '--quiet', '-m', 'add source');
    rmSync(join(root, deletedPath));

    expect(collectDvaSourceFiles(root).map(({ path }) => path)).not.toContain(
      deletedPath
    );
  });

  it('fails closed on source candidates that are symlinks', () => {
    const root = repository();
    const target = join(root, 'outside.ts');
    writeFileSync(target, 'export const hidden = true;\n');
    const candidate = join(root, 'apps/web/src/lib/agentic/symlink-caller.ts');
    mkdirSync(dirname(candidate), { recursive: true });
    symlinkSync(target, candidate);

    expect(lstatSync(candidate).isSymbolicLink()).toBe(true);
    expect(() => collectDvaSourceFiles(root)).toThrow(
      'DVA source inventory contains symlink'
    );
  });
});
