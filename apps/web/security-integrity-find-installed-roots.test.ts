/** @vitest-environment node */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';

// Simulate the install-time race the scanner guards: resolution fails
// after the existence check passed. Everything else passes through.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    realpathSync: ((path: string) => {
      if (path.includes('flaky-pkg')) {
        throw new Error('simulated dangling symlink');
      }
      return actual.realpathSync(path);
    }) as typeof actual.realpathSync,
  };
});

// Colocated coverage for the install scanner: every layout that can
// hide a vulnerable duplicate — hoisted, nested, scoped, and pnpm
// virtual-store copies — must be enumerated from a fixture tree.

let fixture: string;

function pkg(...segments: string[]) {
  const dir = join(fixture, 'node_modules', ...segments);
  mkdirSync(dir, { recursive: true });
  const tail = segments.filter((segment) => segment !== 'node_modules');
  const name =
    tail[0] === '@scope'
      ? `@scope/${tail[tail.length - 1]}`
      : tail[tail.length - 1];
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0' })
  );
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'scan-fixture-'));
  // Hoisted + nested duplicate.
  pkg('dup');
  pkg('parent', 'node_modules', 'dup');
  // Scoped hoisted + scoped nested duplicate.
  pkg('@scope', 'dup');
  pkg('parent', 'node_modules', '@scope', 'dup');
  // pnpm virtual-store copies (two versions).
  pkg('.pnpm', 'dup@1.0.0', 'node_modules', 'dup');
  pkg('.pnpm', 'dup@2.0.0', 'node_modules', 'dup');
  // Name mismatch: Node resolves by directory, not by manifest name,
  // so a directory named `dup` counts even when its manifest disagrees.
  const impostor = join(fixture, 'node_modules', 'other');
  mkdirSync(join(impostor, 'node_modules', 'dup'), { recursive: true });
  writeFileSync(
    join(impostor, 'node_modules', 'dup', 'package.json'),
    JSON.stringify({ name: 'not-dup', version: '0.0.0' })
  );
  // Candidate whose resolution fails after its existence check.
  pkg('flaky-pkg');
  // Stop the upward walk at the fixture root.
  writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'packages: []\n');
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('security-integrity-find-installed-roots', () => {
  it('finds hoisted, nested, and virtual-store copies', () => {
    const roots = findInstalledRoots('dup', fixture).sort();
    const base = realpathSync(join(fixture, 'node_modules'));
    expect(roots).toEqual(
      [
        join(base, '.pnpm', 'dup@1.0.0', 'node_modules', 'dup'),
        join(base, '.pnpm', 'dup@2.0.0', 'node_modules', 'dup'),
        join(base, 'dup'),
        join(base, 'other', 'node_modules', 'dup'),
        join(base, 'parent', 'node_modules', 'dup'),
      ].sort()
    );
  });

  it('finds scoped copies without matching the scope alone', () => {
    const roots = findInstalledRoots('@scope/dup', fixture).sort();
    const base = realpathSync(join(fixture, 'node_modules'));
    expect(roots).toEqual(
      [
        join(base, '@scope', 'dup'),
        join(base, 'parent', 'node_modules', '@scope', 'dup'),
      ].sort()
    );
  });

  it('returns an empty list for a missing package', () => {
    expect(findInstalledRoots('no-such-package-xyz', fixture)).toEqual([]);
  });

  it('returns an empty list for a bare scope query', () => {
    expect(() => findInstalledRoots('@scope', fixture)).not.toThrow();
    expect(findInstalledRoots('@scope', fixture)).toEqual([]);
  });

  it('skips candidates whose resolution fails instead of aborting', () => {
    expect(() => findInstalledRoots('flaky-pkg', fixture)).not.toThrow();
    expect(findInstalledRoots('flaky-pkg', fixture)).toEqual([]);
    // The scan still finds healthy candidates afterwards.
    expect(findInstalledRoots('dup', fixture).length).toBeGreaterThan(0);
  });

  it('throws when the depth cap truncates the walk', () => {
    // A 12-deep chain trips the depth-8 recursion cap.
    let dir = join(fixture, 'node_modules');
    for (let level = 0; level < 12; level += 1) {
      dir = join(dir, `deep${level}`, 'node_modules');
      mkdirSync(dir, { recursive: true });
    }
    expect(() => findInstalledRoots('dup', fixture)).toThrow(
      /depth-8 recursion cap/
    );
    rmSync(join(fixture, 'node_modules', 'deep0'), {
      recursive: true,
      force: true,
    });
  });

  it('throws when a scope chain exceeds the depth cap', () => {
    // Scope descents count toward depth-8 like every other descent.
    let dir = join(fixture, 'node_modules');
    for (let level = 0; level < 10; level += 1) {
      dir = join(dir, `@deep${level}`);
      mkdirSync(dir, { recursive: true });
    }
    mkdirSync(join(dir, 'dup'), { recursive: true });
    writeFileSync(
      join(dir, 'dup', 'package.json'),
      JSON.stringify({ name: 'dup', version: '0.0.0' })
    );
    expect(() => findInstalledRoots('@deep9/dup', fixture)).toThrow(
      /depth-8 recursion cap/
    );
    rmSync(join(fixture, 'node_modules', '@deep0'), {
      recursive: true,
      force: true,
    });
  });

  it('throws when the upward walk hits the 12-level cap', () => {
    // A nonexistent 12-deep start dir never reaches the workspace
    // marker, so the walk exhausts its level budget.
    const ghost = join(
      fixture,
      'g0',
      'g1',
      'g2',
      'g3',
      'g4',
      'g5',
      'g6',
      'g7',
      'g8',
      'g9',
      'g10',
      'g11'
    );
    expect(() => findInstalledRoots('dup', ghost)).toThrow(
      /12-level upward-walk cap/
    );
  });

  it('finds duplicates under sibling workspaces', () => {
    // A mini-monorepo: the caller sits in apps/web, the duplicate in
    // apps/sibling. The `packages:` globs (block list, quoted, with a
    // trailing section) must expand to cover the sibling install.
    const ws = mkdtempSync(join(tmpdir(), 'ws-fixture-'));
    try {
      writeFileSync(
        join(ws, 'pnpm-workspace.yaml'),
        'packages:\n  - "apps/*"\n  - "packages/*"\nallowBuilds:\n  foo: true\n'
      );
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      const sib = join(ws, 'apps', 'sibling', 'node_modules', 'dup');
      mkdirSync(sib, { recursive: true });
      writeFileSync(
        join(sib, 'package.json'),
        JSON.stringify({ name: 'dup', version: '0.0.0' })
      );
      expect(findInstalledRoots('dup', join(ws, 'apps', 'web'))).toEqual([
        realpathSync(sib),
      ]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws on unsupported workspace glob syntax', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-glob-fixture-'));
    try {
      writeFileSync(
        join(ws, 'pnpm-workspace.yaml'),
        'packages:\n  - "apps/**"\n'
      );
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      expect(() => findInstalledRoots('dup', join(ws, 'apps', 'web'))).toThrow(
        /unsupported workspace glob syntax/
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws when the workspace manifest is unreadable', () => {
    // A directory where pnpm-workspace.yaml should be: existsSync
    // passes but readFileSync throws, so the scan must fail closed
    // instead of silently skipping sibling workspaces.
    const ws = mkdtempSync(join(tmpdir(), 'ws-unreadable-fixture-'));
    try {
      mkdirSync(join(ws, 'pnpm-workspace.yaml'));
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      expect(() => findInstalledRoots('dup', join(ws, 'apps', 'web'))).toThrow(
        /cannot read .*pnpm-workspace\.yaml/
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws when the workspace manifest has no packages key', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-keyless-fixture-'));
    try {
      writeFileSync(
        join(ws, 'pnpm-workspace.yaml'),
        'allowBuilds:\n  foo: true\n'
      );
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      expect(() => findInstalledRoots('dup', join(ws, 'apps', 'web'))).toThrow(
        /no packages: key/
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it.each([
    '../shared',
    '/abs/path',
    'apps/../escape',
  ])('throws on out-of-root workspace glob %s', (glob) => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-escape-fixture-'));
    try {
      writeFileSync(
        join(ws, 'pnpm-workspace.yaml'),
        `packages:\n  - "${glob}"\n`
      );
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      expect(() => findInstalledRoots('dup', join(ws, 'apps', 'web'))).toThrow(
        /escapes the root/
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
