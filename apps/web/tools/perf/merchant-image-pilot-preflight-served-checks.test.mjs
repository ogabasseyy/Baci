import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  assertControlPurity,
  assertServedDescriptors,
} from './merchant-image-pilot-preflight-served-checks.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const GEN = 'c'.repeat(64);

function section({ binding, inner, slot, status }) {
  return `<section data-pilot-lab-binding="${binding}" data-pilot-lab-slot="${slot}"${
    status ? ` data-pilot-lab-status="${status}"` : ''
  }>${inner}</section>`;
}

describe('assertControlPurity', () => {
  it('passes a control arm with no staged derivatives', () => {
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<img src="http://localhost:3000/__pilot/originals/${MERCHANT}-logo-a.png">`,
      slot: 'header-logo',
    });
    expect(
      assertControlPurity(html, { origin: 'http://localhost:3000' })
    ).toEqual([]);
  });

  it('reports staged derivatives leaked into the control arm', () => {
    const leaked = `http://localhost:3000/__pilot/${GEN}/${'e'.repeat(64)}.webp`;
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<img src="${leaked}">`,
      slot: 'header-logo',
    });
    const failures = assertControlPurity(html, {
      origin: 'http://localhost:3000',
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/no-tier-leak/);
  });

  it('skips reported sections instead of double-counting', () => {
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<img src="http://localhost:3000/__pilot/${GEN}/${'e'.repeat(64)}.webp">`,
      slot: 'header-logo',
      status: 'not-optimized',
    });
    expect(
      assertControlPurity(html, { origin: 'http://localhost:3000' })
    ).toEqual([]);
  });
});

describe('assertServedDescriptors', () => {
  it('refuses descriptor URLs traversing outside the public dir', async () => {
    // A /__pilot/ URL with .. segments passes the prefix check but must
    // never reach Sharp: the decoy outside matches the descriptor, so an
    // unconfined read would pass while the confined gate fails closed.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-trav-'));
    const outside = await mkdtemp(join(tmpdir(), 'pilot-served-out-'));
    const decoy = join(outside, 'decoy.webp');
    await writeFile(
      decoy,
      await sharp({
        create: { background: '#1c1917', channels: 3, height: 10, width: 48 },
      })
        .webp()
        .toBuffer()
    );
    const realPublic = await realpath(publicDir);
    const realDecoy = await realpath(decoy);
    const rel = relative(join(realPublic, '__pilot', GEN), realDecoy)
      .split(sep)
      .join('/');
    const traversal = `/__pilot/${GEN}/${rel}`;
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<picture><source srcSet="${traversal} 48w" type="image/webp"/><img src="${traversal}" alt="logo"/></picture><img src="${traversal}" alt="standalone"/>`,
      slot: 'header-logo',
    });
    const failures = await assertServedDescriptors(html, {
      arm: 'pilot',
      origin: 'http://localhost:3000',
      publicDir,
    });
    // Both the bare img src and the width-described source refuse.
    expect(failures.length).toBe(2);
    for (const failure of failures) {
      expect(failure).toMatch(/does not decode/);
    }
  });

  it('skips reported sections without touching staged bytes', async () => {
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: '<p>not optimized</p>',
      slot: 'header-logo',
      status: 'not-optimized',
    });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-checks-'));
    const failures = await assertServedDescriptors(html, {
      arm: 'pilot',
      origin: 'http://localhost:3000',
      publicDir,
    });
    expect(failures).toEqual([]);
  });

  it('matches width descriptors against oriented bytes', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-oriented-'));
    await mkdir(join(publicDir, '__pilot', GEN), { recursive: true });
    // Stored 32x48 with orientation 6 renders 48 wide; the descriptor
    // claims the oriented width. Raw-axis comparison would fail this.
    const bytes = await sharp({
      create: { background: '#1c1917', channels: 3, height: 48, width: 32 },
    })
      .withMetadata({ orientation: 6 })
      .webp()
      .toBuffer();
    const staged = `/__pilot/${GEN}/${'d'.repeat(64)}.webp`;
    await writeFile(join(publicDir, staged), bytes);
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<picture><source srcSet="${staged} 48w" type="image/webp"/><img src="${staged}" alt="logo"/></picture>`,
      slot: 'header-logo',
    });
    const failures = await assertServedDescriptors(html, {
      arm: 'pilot',
      origin: 'http://localhost:3000',
      publicDir,
    });
    expect(failures).toEqual([]);
  });

  it('verifies every density candidate without claiming a width', async () => {
    // A control next/image `1x, 2x` srcset: the 2x file is 48 wide, not
    // 2 — a width claim would false-fail — but both candidates must
    // still exist and decode, or the DPR-2 route goes unverified.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-density-'));
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    const one = '/__pilot/originals/one.png';
    const two = '/__pilot/originals/two.png';
    for (const file of [one, two]) {
      const bytes = await sharp({
        create: { background: '#1c1917', channels: 3, height: 24, width: 48 },
      })
        .png()
        .toBuffer();
      await writeFile(join(publicDir, file), bytes);
    }
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<picture><source srcSet="${one} 1x, ${two} 2x" type="image/png"/><img src="${one}" alt="logo"/></picture>`,
      slot: 'header-logo',
    });
    expect(
      await assertServedDescriptors(html, {
        arm: 'control',
        origin: 'http://localhost:3000',
        publicDir,
      })
    ).toEqual([]);
  });

  it('verifies queried generation URLs but exempts loader originals', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-query-'));
    await mkdir(join(publicDir, '__pilot', GEN), { recursive: true });
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    const tier = `/__pilot/${GEN}/tier-384.webp`;
    await writeFile(
      join(publicDir, tier),
      await sharp({
        create: { background: '#1c1917', channels: 3, height: 200, width: 384 },
      })
        .webp()
        .toBuffer()
    );
    const original = `/__pilot/originals/${MERCHANT}-logo-a.png`;
    await writeFile(
      join(publicDir, original),
      await sharp({
        create: { background: '#1c1917', channels: 3, height: 60, width: 90 },
      })
        .png()
        .toBuffer()
    );
    const check = (inner) =>
      assertServedDescriptors(
        section({
          binding: `${MERCHANT}/logo-a`,
          inner,
          slot: 'header-logo',
        }),
        { arm: 'pilot', origin: 'http://localhost:3000', publicDir }
      );
    // A cache-busted tier URL still claims its descriptor against the
    // static staged file: a lying descriptor must fail, not skip.
    expect(
      await check(
        `<picture><source srcSet="${tier}?v=1 1280w" type="image/webp"/></picture>`
      )
    ).toEqual([
      expect.stringMatching(
        /descriptor 1280w does not match oriented width 384/
      ),
    ]);
    expect(
      await check(
        `<picture><source srcSet="${tier}?v=1 384w" type="image/webp"/></picture>`
      )
    ).toEqual([]);
    // Loader-rendered originals name a requested width: exempt as before.
    expect(
      await check(
        `<picture><source srcSet="${original}?w=48&q=75 48w" type="image/png"/></picture>`
      )
    ).toEqual([]);
  });
});
