/** @vitest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandWorkspaces } from './security-integrity-workspace-globs';

function withWorkspace(yaml: string, verify: (ws: string) => void): void {
  const ws = mkdtempSync(join(tmpdir(), 'ws-globs-fixture-'));
  try {
    writeFileSync(join(ws, 'pnpm-workspace.yaml'), yaml);
    verify(ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

describe('security-integrity-workspace-globs', () => {
  it('expands block-list globs to workspace dirs', () => {
    withWorkspace('packages:\n  - "apps/*"\n  - "packages/*"\n', (ws) => {
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      mkdirSync(join(ws, 'apps', 'sibling'), { recursive: true });
      mkdirSync(join(ws, 'apps', '.hidden'), { recursive: true });
      mkdirSync(join(ws, 'apps', 'node_modules'), { recursive: true });
      // Hidden and node_modules entries never match a glob segment.
      expect(expandWorkspaces(ws).sort()).toEqual(
        [join(ws, 'apps', 'sibling'), join(ws, 'apps', 'web')].sort()
      );
    });
  });

  it('expands flow lists and literal paths', () => {
    withWorkspace('packages: ["apps/web", "libs/*"]\n', (ws) => {
      mkdirSync(join(ws, 'apps', 'web'), { recursive: true });
      mkdirSync(join(ws, 'libs', 'one'), { recursive: true });
      expect(expandWorkspaces(ws).sort()).toEqual(
        [join(ws, 'apps', 'web'), join(ws, 'libs', 'one')].sort()
      );
    });
  });

  it('returns an empty list for an explicit empty packages list', () => {
    withWorkspace('packages: []\n', (ws) => {
      expect(expandWorkspaces(ws)).toEqual([]);
    });
  });

  it('treats a missing glob base as an empty match', () => {
    withWorkspace('packages:\n  - "nodir/*"\n', (ws) => {
      expect(expandWorkspaces(ws)).toEqual([]);
    });
  });

  it.each([
    'foo..bar',
    '..leading',
    'trailing..',
  ])('accepts dots that are not parent segments in %s', (glob) => {
    // The escape check is segment-based: a literal directory name
    // merely containing dots expands (callers check existence).
    withWorkspace(`packages:\n  - "${glob}"\n`, (ws) => {
      expect(expandWorkspaces(ws)).toEqual([join(ws, glob)]);
    });
  });

  it.each([
    '../shared',
    '/abs/path',
    'apps/../escape',
    'apps\\..\\escape',
  ])('throws on out-of-root workspace glob %s', (glob) => {
    withWorkspace(`packages:\n  - "${glob}"\n`, (ws) => {
      expect(() => expandWorkspaces(ws)).toThrow(/escapes the root/);
    });
  });

  it('throws on unsupported workspace glob syntax', () => {
    withWorkspace('packages:\n  - "apps/**"\n', (ws) => {
      expect(() => expandWorkspaces(ws)).toThrow(
        /unsupported workspace glob syntax/
      );
    });
  });

  it('throws when the workspace manifest is unreadable', () => {
    // A directory where pnpm-workspace.yaml should be: existsSync
    // passes but readFileSync throws, so expansion must fail closed
    // instead of silently skipping sibling workspaces.
    withWorkspace('packages: []\n', (ws) => {
      rmSync(join(ws, 'pnpm-workspace.yaml'));
      mkdirSync(join(ws, 'pnpm-workspace.yaml'));
      expect(() => expandWorkspaces(ws)).toThrow(
        /cannot read .*pnpm-workspace\.yaml/
      );
    });
  });

  it('throws when the workspace manifest has no packages key', () => {
    withWorkspace('allowBuilds:\n  foo: true\n', (ws) => {
      expect(() => expandWorkspaces(ws)).toThrow(/no packages: key/);
    });
  });
});
