/** @vitest-environment node */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findInstalledRoots, overrideRoots } from './security-integrity-scan';

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
  // Stop the upward walk at the fixture root.
  writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'packages: []\n');
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('security-integrity-scan', () => {
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
});

describe('overrideRoots', () => {
  it('returns null when unset or empty', () => {
    expect(overrideRoots(undefined, 'GTU_ROOTS')).toBeNull();
    expect(overrideRoots('', 'GTU_ROOTS')).toBeNull();
  });

  it('splits on the platform path delimiter', () => {
    const joined = ['/a', '/b'].join(delimiter);
    expect(overrideRoots(joined, 'GTU_ROOTS')).toEqual(['/a', '/b']);
  });

  it('refuses overrides under CI', () => {
    const savedCI = process.env.CI;
    process.env.CI = 'true';
    try {
      expect(() => overrideRoots('/a', 'GTU_ROOTS')).toThrow(
        /refusing to test non-installed copies/
      );
    } finally {
      // Restore, never blank: the runner normally has CI set, and
      // clearing it would weaken later CI-refusal assertions in this
      // worker.
      if (savedCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = savedCI;
      }
    }
  });
});
