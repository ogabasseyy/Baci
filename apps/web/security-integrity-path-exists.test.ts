/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathExists } from './security-integrity-path-exists';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statSync: ((path: string) => {
      if (typeof path === 'string' && path.includes('denied-probe')) {
        throw Object.assign(new Error('simulated EACCES'), { code: 'EACCES' });
      }
      return actual.statSync(path);
    }) as typeof actual.statSync,
  };
});

describe('security-integrity-path-exists', () => {
  it('returns true for an existing path', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-exists-fixture-'));
    try {
      const file = join(ws, 'pkg.json');
      writeFileSync(file, '{}');
      expect(pathExists(file)).toBe(true);
      expect(pathExists(ws)).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('returns false for a missing path', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-missing-fixture-'));
    try {
      expect(pathExists(join(ws, 'no-such-dir', 'node_modules'))).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('throws fail-closed when the probe itself is unreadable', () => {
    // existsSync would report false here and silently skip the tree;
    // the throwing probe surfaces EACCES instead.
    expect(() => pathExists(join('denied-probe', 'node_modules'))).toThrow(
      /EACCES/
    );
  });
});
