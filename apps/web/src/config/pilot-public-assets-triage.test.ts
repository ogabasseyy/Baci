import {
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
  assertNoUnboundStagedContent,
} from './pilot-public-assets-triage';

const PINNED = new Set([
  'grid-filler-600x400-a.png',
  'grid-filler-600x400-b.png',
  'grid-filler-600x400-c.png',
]);

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
  it('passes pinned fixtures by name without hashing', () => {
    // A recompressed filler (right name, wrong bytes) must not brick a
    // non-lab boot: hash pinning is lab-only.
    const dir = root();
    const fillers = join(dir, '__pilot', 'fillers');
    mkdirSync(fillers, { recursive: true });
    for (const name of PINNED) {
      writeFileSync(join(fillers, name), 'recompressed bytes');
    }
    expect(() =>
      assertNonLabFillers(join(dir, '__pilot'), 'fillers', PINNED)
    ).not.toThrow();
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
