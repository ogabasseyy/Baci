import {
  existsSync,
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
  hasPilotIntent,
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
  it('refuses an unchecked boot when pilot intent is configured', () => {
    // Zero candidates means the gate checked NOTHING: with pilot env
    // configured (lab-off but operator intends pilot use), a custom
    // server rooted elsewhere would serve its real tree unverified —
    // a loud misconfiguration refusal, not a silent pass.
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', '/operator/input');
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
  it('warns without pilot configuration (serverless-style boot)', () => {
    // Vercel/serverless functions, migrations, and workers carry no
    // pilot env and structurally cannot anchor: a lab-only feature
    // must not brick them, so the nothing-checked boot warns loudly
    // instead of refusing. Scrub the runner's LAB=1: intent reads the
    // live environment, and this case is defined by its absence.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const dir = root();
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(dir);
    process.argv[1] = join(dir, 'nowhere', 'runner.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => assertUnanchoredPublicTrees()).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/no pilot configuration detected/);
    } finally {
      warn.mockRestore();
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
  it('warns on staged content found in a candidate tree', () => {
    // Lab-off: the helper only runs when the lab flag is down (lab-on
    // unanchored boots stay fatal in the resolver). Foreign-tree
    // severity: a dirty candidate warns-and-continues WITHOUT
    // quarantine rather than bricking a migration or worker that
    // merely runs near an app dir — the candidate may belong to a
    // live lab session elsewhere, so this process must not mutate it.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const dir = root();
    const originals = join(dir, 'public', '__pilot', 'originals');
    mkdirSync(originals, { recursive: true });
    writeFileSync(join(originals, 'm1-a1.png'), 'merchant bytes');
    const previousCwd = process.cwd();
    process.chdir(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => assertUnanchoredPublicTrees()).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toMatch(/checked 1 candidate tree/);
      expect(warn.mock.calls[1][0]).toMatch(/staged merchant pilot assets/);
      expect(warn.mock.calls[1][0]).toMatch(
        /without quarantine \(foreign tree\)/
      );
    } finally {
      warn.mockRestore();
      process.chdir(previousCwd);
    }
    expect(existsSync(join(originals, 'm1-a1.png'))).toBe(true);
  });
  it('refuses staged content found in a candidate tree with pilot intent', () => {
    // The exact case this branch exists for: a custom server whose
    // served tree is a candidate but is not anchored, on a box the
    // operator configured for the pilot. Refusal (no quarantine —
    // the foreign tree must not be mutated), not warn-and-serve.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', 'https://lab.example');
    const dir = root();
    const originals = join(dir, 'public', '__pilot', 'originals');
    mkdirSync(originals, { recursive: true });
    writeFileSync(join(originals, 'm1-a1.png'), 'merchant bytes');
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => assertUnanchoredPublicTrees()).toThrow(
        /staged merchant pilot assets/
      );
    } finally {
      process.chdir(previousCwd);
    }
    expect(existsSync(join(originals, 'm1-a1.png'))).toBe(true);
  });

  it('warns on candidate filler drift without pilot intent', () => {
    // Intent-gated drift: synthetic fixtures on a box that never
    // opted in warn (deploy-pipeline recompression) instead of
    // bricking an unrelated migration or worker.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const dir = root();
    const fillers = join(dir, 'public', '__pilot', 'fillers');
    mkdirSync(join(dir, 'public', '__pilot', 'originals'), { recursive: true });
    mkdirSync(fillers, { recursive: true });
    writeFileSync(
      join(fillers, 'grid-filler-600x400-a.png'),
      'recompressed bytes'
    );
    const previousCwd = process.cwd();
    process.chdir(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => assertUnanchoredPublicTrees()).not.toThrow();
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).match(/does not match the pinned hash/)
        )
      ).toBe(true);
    } finally {
      warn.mockRestore();
      process.chdir(previousCwd);
    }
  });

  it('refuses candidate filler drift with pilot intent', () => {
    // With pilot intent the box is a lab participant: drift means
    // post-build tamper and stays fatal.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', 'https://lab.example');
    const dir = root();
    const fillers = join(dir, 'public', '__pilot', 'fillers');
    mkdirSync(join(dir, 'public', '__pilot', 'originals'), { recursive: true });
    mkdirSync(fillers, { recursive: true });
    writeFileSync(join(fillers, 'grid-filler-600x400-a.png'), 'tampered bytes');
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => assertUnanchoredPublicTrees()).toThrow(
        /does not match the pinned hash/
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('ignores the unanchored ACK flag for pilot intent', () => {
    // The ACK opts into an unchecked boot; alone it must not count
    // as intent, or candidates-found findings upgrade warn→throw.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_IMAGE_PILOT_UNANCHORED_ACK', '1');
    expect(hasPilotIntent()).toBe(false);
    vi.stubEnv('BACI_IMAGE_PILOT_UNANCHORED_ACK', 'true');
    expect(hasPilotIntent()).toBe(true);
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    expect(hasPilotIntent()).toBe(true);
  });

  it('warns on candidate staged content under ACK-only', () => {
    // ACK-only with a checkable tree: the operator accepted
    // unchecked operation, so staged content warns like no-intent.
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_IMAGE_PILOT_UNANCHORED_ACK', '1');
    const dir = root();
    const originals = join(dir, 'public', '__pilot', 'originals');
    mkdirSync(originals, { recursive: true });
    writeFileSync(join(originals, 'm1-a1.png'), 'merchant bytes');
    const previousCwd = process.cwd();
    process.chdir(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => assertUnanchoredPublicTrees()).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      process.chdir(previousCwd);
    }
  });
});
