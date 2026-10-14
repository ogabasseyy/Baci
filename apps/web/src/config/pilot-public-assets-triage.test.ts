import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertNonLabFillers,
  readGuardedFillerBytes,
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
  it('refuses merchant bytes nested under a pinned-name directory', () => {
    // A directory named grid-filler-600x400-a.png is not the fixture:
    // the exemption must not skip it before the scan sees the
    // merchant.jpg child Next would serve.
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    const masquerade = join(fillers, 'grid-filler-600x400-a.png');
    mkdirSync(masquerade, { recursive: true });
    writeFileSync(join(masquerade, 'merchant.jpg'), 'merchant bytes');
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
  it('throws on hash drift in strict (build-gate) mode', () => {
    // Builds fail where boots only warn: a merchant image renamed to a
    // pinned filler name must never ship silently, and failing
    // pre-deploy is cheap with a clear re-pin fix.
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(fillers, { recursive: true });
    for (const name of PINNED_NAMES) {
      writeFileSync(join(fillers, name), 'recompressed bytes');
    }
    expect(() =>
      assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED, 'throw')
    ).toThrow(/does not match the pinned hash/);
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

describe('readGuardedFillerBytes', () => {
  it('reads a regular single-link file', () => {
    const dir = root();
    writeFileSync(join(dir, 'a.png'), 'bytes');
    expect(
      readGuardedFillerBytes(join(dir, 'a.png'), 'non-lab public pilot tree')
    ).toEqual(Buffer.from('bytes'));
  });
  it('refuses a symlink without following it', () => {
    const dir = root();
    writeFileSync(join(dir, 'outside.txt'), 'not yours');
    symlinkSync(join(dir, 'outside.txt'), join(dir, 'a.png'));
    expect(() =>
      readGuardedFillerBytes(join(dir, 'a.png'), 'non-lab public pilot tree')
    ).toThrow(/contains an unapproved filler/);
  });
  it('refuses a FIFO without hanging', () => {
    // O_NONBLOCK keeps the open from blocking; fstat then rejects the
    // non-file. mkfifo exists only on POSIX.
    if (process.platform === 'win32') {
      return;
    }
    const dir = root();
    execFileSync('mkfifo', [join(dir, 'a.png')]);
    expect(() =>
      readGuardedFillerBytes(join(dir, 'a.png'), 'non-lab public pilot tree')
    ).toThrow(/contains an unapproved filler/);
  });
  it('refuses a multi-linked file', () => {
    const dir = root();
    writeFileSync(join(dir, 'a.png'), 'bytes');
    linkSync(join(dir, 'a.png'), join(dir, 'mirror.png'));
    expect(() =>
      readGuardedFillerBytes(join(dir, 'a.png'), 'non-lab public pilot tree')
    ).toThrow(/contains a hardlinked filler/);
  });
});
