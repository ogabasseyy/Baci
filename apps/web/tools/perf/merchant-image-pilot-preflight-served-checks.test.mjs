import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertControlPurity,
  assertServedDescriptors,
  assertServedResponseBytes,
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
});

describe('assertServedResponseBytes', () => {
  it('fails closed when the served page exposes no lab URLs', async () => {
    const html = '<html><body><p>no images here</p></body></html>';
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-checks-'));
    const failures = await assertServedResponseBytes(html, {
      arm: 'pilot',
      origin: 'http://localhost:3000',
      publicDir,
      timeoutMs: 1000,
    });
    expect(failures).toEqual([
      'served:pilot:response-bytes: no lab image URLs found to verify',
    ]);
  });
});
