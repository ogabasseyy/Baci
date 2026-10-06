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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-scan';

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
});
