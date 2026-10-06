/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';

// Failure-mode coverage for the install scanner, split from the main
// colocated suite by the 300-line file gate. Only ENOENT/ENOTDIR may
// narrow the scan silently; any other filesystem error throws
// fail-closed. Markers keep the mock from touching real paths.

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const denied = (path: string) =>
    typeof path === 'string' && path.includes('denied-dir');
  return {
    ...actual,
    realpathSync: ((path: string) => {
      if (denied(path)) {
        throw Object.assign(new Error('simulated EACCES'), { code: 'EACCES' });
      }
      return actual.realpathSync(path);
    }) as typeof actual.realpathSync,
    readdirSync: ((path: string, options?: object) => {
      if (denied(path)) {
        throw Object.assign(new Error('simulated EACCES'), { code: 'EACCES' });
      }
      return options === undefined
        ? actual.readdirSync(path)
        : actual.readdirSync(path, options as { withFileTypes: true });
    }) as typeof actual.readdirSync,
  };
});

describe('security-integrity-find-installed-roots error paths', () => {
  it('throws when a workspace glob base is unreadable', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-denied-fixture-'));
    try {
      writeFileSync(
        join(ws, 'pnpm-workspace.yaml'),
        'packages:\n  - "denied-dir/*"\n'
      );
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      expect(() => findInstalledRoots('dup', join(ws, 'apps', 'web'))).toThrow(
        /EACCES/
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws when a nested scan directory is unreadable', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-scan-fixture-'));
    try {
      writeFileSync(join(ws, 'pnpm-workspace.yaml'), 'packages: []\n');
      const nested = join(ws, 'node_modules', 'denied-dir', 'node_modules');
      const hidden = join(nested, 'dup');
      mkdirSync(hidden, { recursive: true });
      writeFileSync(
        join(hidden, 'package.json'),
        JSON.stringify({ name: 'dup', version: '0.0.0' })
      );
      expect(() => findInstalledRoots('dup', ws)).toThrow(/EACCES/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws when an ancestor modules dir is unreadable', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-modules-fixture-'));
    try {
      writeFileSync(join(ws, 'pnpm-workspace.yaml'), 'packages: []\n');
      // The marker's node_modules exists (passing the existsSync
      // guard) but its resolution throws EACCES; the ghost child
      // keeps the upward walk stopping at the manifest.
      mkdirSync(join(ws, 'denied-dir', 'node_modules'), { recursive: true });
      const ghost = join(ws, 'denied-dir', 'ghost-child');
      expect(() => findInstalledRoots('dup', ghost)).toThrow(/EACCES/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws when a matched candidate is unreadable', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-candidate-fixture-'));
    try {
      writeFileSync(join(ws, 'pnpm-workspace.yaml'), 'packages: []\n');
      const candidate = join(ws, 'node_modules', 'denied-dir');
      mkdirSync(candidate, { recursive: true });
      writeFileSync(
        join(candidate, 'package.json'),
        JSON.stringify({ name: 'denied-dir', version: '0.0.0' })
      );
      expect(() => findInstalledRoots('denied-dir', ws)).toThrow(/EACCES/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
