import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolvePilotPublicDir,
  resolveRoutePublicDir,
} from './pilot-public-assets';

describe('resolvePilotPublicDir', () => {
  const argv1 = process.argv[1];
  afterEach(() => {
    process.argv[1] = argv1;
    vi.unstubAllEnvs();
  });
  it('prefers the config-stashed root', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/app/public');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '{}');
    expect(resolvePilotPublicDir()).toBe('/app/public');
  });
  it('anchors standalone boots to the server script, not cwd', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '{}');
    process.argv[1] = '/srv/standalone/apps/web/server.js';
    expect(resolvePilotPublicDir()).toBe('/srv/standalone/apps/web/public');
  });
  it('fails closed without an anchored root instead of checking cwd', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    expect(() => resolvePilotPublicDir()).toThrow(/cannot anchor/);
  });
});

describe('resolveRoutePublicDir', () => {
  const argv1 = process.argv[1];
  afterEach(() => {
    process.argv[1] = argv1;
    vi.unstubAllEnvs();
  });
  it('prefers the explicit route var, then the gate stash, then cwd', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/route/public');
    expect(resolveRoutePublicDir()).toBe('/route/public');
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '');
    expect(resolveRoutePublicDir()).toBe('/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    expect(resolveRoutePublicDir()).toBe(join(process.cwd(), 'public'));
  });
  it('fails closed when the two roots disagree', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '/gate/public');
    expect(() => resolveRoutePublicDir()).toThrow(/disagrees/);
  });
  it('trusts an explicit route var with no anchored gate root', () => {
    // Lab dev flow: explicit override, no stash, no standalone boot.
    // A legacy cwd/public fallback is not a verified tree, so there
    // is nothing to disagree with.
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '/route/public');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    expect(resolveRoutePublicDir()).toBe('/route/public');
  });
  it('falls back to the standalone-aware gate root on a cold start', () => {
    // No stash, no explicit var, standalone boot: the route must serve
    // the tree beside the server (where the gate verified), not a bare
    // cwd/public that diverges from the gate.
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '{}');
    process.argv[1] = '/srv/standalone/apps/web/server.js';
    expect(resolveRoutePublicDir()).toBe('/srv/standalone/apps/web/public');
  });
  it('accepts symlinked-ancestor aliases of the same tree', () => {
    // The route var may spell the tree through a symlinked ancestor
    // (/var/... on macOS) while the gate stashed the physical path:
    // distinct spellings of one directory must not read as disagreement.
    const physical = mkdtempSync(join(tmpdir(), 'pilot-public-alias-'));
    const logical = `${physical}-link`;
    symlinkSync(physical, logical);
    try {
      vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', logical);
      vi.stubEnv('BACI_PILOT_PUBLIC_DIR', realpathSync(physical));
      expect(resolveRoutePublicDir()).toBe(logical);
    } finally {
      rmSync(logical, { force: true, recursive: true });
      rmSync(physical, { force: true, recursive: true });
    }
  });
});
