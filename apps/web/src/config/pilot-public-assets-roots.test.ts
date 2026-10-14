import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertNoUnboundStagedContent,
  resolvePilotPublicDir,
  resolveRoutePublicDir,
} from './pilot-public-assets-roots';

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
  it('canonicalizes a symlinked server entry before anchoring', () => {
    // Node resolves the main module to the link TARGET (which Next
    // uses as its server root) while argv[1] keeps the link pathname:
    // anchoring lexically would inspect the link dir's public/
    // (absent → pass) while the target tree stays served.
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-argv-')));
    const target = join(base, 'target');
    const linkDir = join(base, 'link');
    mkdirSync(join(target, 'public'), { recursive: true });
    writeFileSync(join(target, 'server.js'), 'entry');
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(join(target, 'server.js'), join(linkDir, 'server.js'));
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '{}');
    const argvBefore = process.argv[1];
    process.argv[1] = join(linkDir, 'server.js');
    try {
      expect(resolvePilotPublicDir()).toBe(join(target, 'public'));
    } finally {
      process.argv[1] = argvBefore;
      rmSync(base, { force: true, recursive: true });
    }
  });
  it('fails closed without an anchored root instead of checking cwd', () => {
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    expect(() => resolvePilotPublicDir()).toThrow(/cannot anchor/);
  });
  it('codes the anchor failure for the boot-gate catch', () => {
    // The boot gate catches ONLY this coded failure for its
    // unanchored-candidates path; staged-content refusals (uncoded)
    // must propagate, never degrade.
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    try {
      resolvePilotPublicDir();
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: unknown }).code).toBe(
        'PILOT_PUBLIC_UNANCHORED'
      );
    }
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

describe('assertNoUnboundStagedContent', () => {
  it('passes an absent, empty, or fillers-only tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-public-unbound-'));
    try {
      expect(() => assertNoUnboundStagedContent(dir)).not.toThrow();
      mkdirSync(join(dir, '__pilot'), { recursive: true });
      expect(() => assertNoUnboundStagedContent(dir)).not.toThrow();
      mkdirSync(join(dir, '__pilot', 'fillers'), { recursive: true });
      expect(() => assertNoUnboundStagedContent(dir)).not.toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
  it.each([
    'originals',
    'b'.repeat(64),
    'notes.txt',
  ])('refuses boot with unbound %s present', (entry) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-public-unbound-'));
    try {
      mkdirSync(join(dir, '__pilot', 'fillers'), { recursive: true });
      if (entry.includes('.')) {
        writeFileSync(join(dir, '__pilot', entry), 'stray');
      } else {
        mkdirSync(join(dir, '__pilot', entry), { recursive: true });
      }
      expect(() => assertNoUnboundStagedContent(dir)).toThrow(
        /failed to initialize with 1 unbound entry/
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
