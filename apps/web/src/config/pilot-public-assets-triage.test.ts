import { createHash } from 'node:crypto';
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
  assertNonLabFillers,
  assertNoUnboundStagedContent,
  cwdPublicDirIfAppRoot,
} from './pilot-public-assets-triage';

const PINNED_NAMES = [
  'grid-filler-600x400-a.png',
  'grid-filler-600x400-b.png',
  'grid-filler-600x400-c.png',
];
const PINNED = Object.fromEntries(
  PINNED_NAMES.map((name) => [
    name,
    createHash('sha256').update(`committed ${name}`).digest('hex'),
  ])
);

const roots: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-public-triage-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('assertNonLabFillers', () => {
  it('refuses a staged merchant file hiding under fillers', () => {
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(fillers, { recursive: true });
    writeFileSync(join(fillers, 'merchant.png'), 'merchant bytes');
    expect(() =>
      assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED)
    ).toThrow(/staged merchant pilot assets/);
  });
  it('refuses a symlinked fillers directory', () => {
    const dir = root();
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    mkdirSync(join(dir, 'real-fillers'), { recursive: true });
    symlinkSync(join(dir, 'real-fillers'), join(dir, '__pilot', 'fillers'));
    expect(() =>
      assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED)
    ).toThrow(/not a confined directory/);
  });
  it('passes pinned fixtures by name but warns on hash drift', () => {
    // A recompressed filler (right name, wrong bytes) must not brick a
    // non-lab boot — but the drift must be visible, not silently
    // served: hash refusal is lab-only, hash warning is not.
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(fillers, { recursive: true });
    for (const name of PINNED_NAMES) {
      writeFileSync(join(fillers, name), 'recompressed bytes');
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED)
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(3);
      expect(warn.mock.calls[0][0]).toMatch(/does not match the pinned hash/);
    } finally {
      warn.mockRestore();
    }
  });
  it('stays silent for pinned fixtures with matching hashes', () => {
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(fillers, { recursive: true });
    for (const name of PINNED_NAMES) {
      writeFileSync(join(fillers, name), `committed ${name}`);
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED)
      ).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it('warns on non-merchant strays under fillers', () => {
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(fillers, { recursive: true });
    writeFileSync(join(fillers, '.DS_Store'), 'packaging artifact');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED)
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/stray file/);
  });
});

describe('cwdPublicDirIfAppRoot', () => {
  it('returns cwd/public when the cwd holds a public dir', () => {
    // Physical path: mkdtemp under /tmp spells a symlinked ancestor
    // on macOS while chdir resolves it.
    const dir = realpathSync(root());
    mkdirSync(join(dir, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(cwdPublicDirIfAppRoot()).toBe(join(dir, 'public'));
    } finally {
      process.chdir(previousCwd);
    }
  });
  it('returns cwd/public when the cwd holds a next config', () => {
    const dir = realpathSync(root());
    writeFileSync(join(dir, 'next.config.ts'), 'export default {};');
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(cwdPublicDirIfAppRoot()).toBe(join(dir, 'public'));
    } finally {
      process.chdir(previousCwd);
    }
  });
  it('refuses when the cwd is provably not an app root', () => {
    const dir = root();
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => cwdPublicDirIfAppRoot()).toThrow(/not a Next app root/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('assertNoUnboundStagedContent', () => {
  it('passes an absent, empty, or fillers-only tree', () => {
    const dir = root();
    expect(() => assertNoUnboundStagedContent(dir)).not.toThrow();
    mkdirSync(join(dir, '__pilot'), { recursive: true });
    expect(() => assertNoUnboundStagedContent(dir)).not.toThrow();
    mkdirSync(join(dir, '__pilot', 'fillers'), { recursive: true });
    expect(() => assertNoUnboundStagedContent(dir)).not.toThrow();
  });
  it.each([
    'originals',
    'b'.repeat(64),
    'notes.txt',
  ])('refuses boot with unbound %s present', (entry) => {
    const dir = root();
    mkdirSync(join(dir, '__pilot', 'fillers'), { recursive: true });
    if (entry.includes('.')) {
      writeFileSync(join(dir, '__pilot', entry), 'stray');
    } else {
      mkdirSync(join(dir, '__pilot', entry), { recursive: true });
    }
    expect(() => assertNoUnboundStagedContent(dir)).toThrow(
      /failed to initialize with 1 unbound entry/
    );
  });
});
