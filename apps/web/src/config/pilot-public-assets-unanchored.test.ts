import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertUnanchoredPublicTrees,
  unanchoredCandidatePublicDirs,
} from './pilot-public-assets-unanchored';

const roots: string[] = [];
function root() {
  // Physical path: mkdtemp under /tmp spells a symlinked ancestor on
  // macOS while chdir resolves it.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-unanchored-')));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('unanchoredCandidatePublicDirs', () => {
  it('returns the cwd tree when the cwd holds a public dir', () => {
    const dir = root();
    mkdirSync(join(dir, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(unanchoredCandidatePublicDirs()).toEqual([join(dir, 'public')]);
    } finally {
      process.chdir(previousCwd);
    }
  });
  it('returns the cwd tree when the cwd holds a next config', () => {
    const dir = root();
    writeFileSync(join(dir, 'next.config.mjs'), 'export default {};');
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(unanchoredCandidatePublicDirs()).toEqual([join(dir, 'public')]);
    } finally {
      process.chdir(previousCwd);
    }
  });
  it('adds the tree beside the server entry script', () => {
    const dir = root();
    const appRoot = root();
    mkdirSync(join(appRoot, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(dir);
    process.argv[1] = join(appRoot, 'server.js');
    try {
      expect(unanchoredCandidatePublicDirs()).toEqual([
        join(appRoot, 'public'),
      ]);
    } finally {
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
    }
  });
  it('dedups when the entry script sits in the cwd tree', () => {
    const dir = root();
    mkdirSync(join(dir, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(dir);
    process.argv[1] = join(dir, 'server.js');
    try {
      expect(unanchoredCandidatePublicDirs()).toEqual([join(dir, 'public')]);
    } finally {
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
    }
  });
  it('returns nothing for a bare cwd with no adjacent tree', () => {
    const dir = root();
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(dir);
    process.argv[1] = join(dir, 'nowhere', 'runner.js');
    try {
      expect(unanchoredCandidatePublicDirs()).toEqual([]);
    } finally {
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
    }
  });
});

describe('assertUnanchoredPublicTrees', () => {
  it('refuses an unchecked boot without the explicit ack', () => {
    // Zero candidates means the gate checked NOTHING: a custom server
    // rooted elsewhere would serve its real tree unverified, so only
    // an explicit operator acknowledgement degrades this to a warning.
    const dir = root();
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(dir);
    process.argv[1] = join(dir, 'nowhere', 'runner.js');
    try {
      expect(() => assertUnanchoredPublicTrees()).toThrow(
        /refusing an unchecked boot/
      );
    } finally {
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
    }
  });
  it('warns distinctively when nothing is checkable but acked', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_UNANCHORED_ACK', '1');
    const dir = root();
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(dir);
    process.argv[1] = join(dir, 'nowhere', 'runner.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => assertUnanchoredPublicTrees()).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/found no checkable app tree/);
      expect(warn.mock.calls[0][0]).toMatch(/UNANCHORED_ACK=1/);
    } finally {
      warn.mockRestore();
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
    }
  });
  it('refuses staged content found in a candidate tree', () => {
    // Lab-off: the helper only runs when the lab flag is down (lab-on
    // unanchored boots stay fatal in the resolver).
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const dir = root();
    const originals = join(dir, 'public', '__pilot', 'originals');
    mkdirSync(originals, { recursive: true });
    writeFileSync(join(originals, 'm1-a1.png'), 'merchant bytes');
    const previousCwd = process.cwd();
    process.chdir(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => assertUnanchoredPublicTrees()).toThrow(
        /staged merchant pilot assets/
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/checked 1 candidate tree/);
    } finally {
      warn.mockRestore();
      process.chdir(previousCwd);
    }
  });
});
