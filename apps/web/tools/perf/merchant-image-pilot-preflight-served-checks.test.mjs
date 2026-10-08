import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
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

  it('rejects hash-identical bytes served under the wrong MIME type', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-mime-'));
    const staged = `/__pilot/${GEN}/${'f'.repeat(64)}.avif`;
    await mkdir(join(publicDir, '__pilot', GEN), { recursive: true });
    const bytes = Buffer.from('fake-avif-bytes');
    await writeFile(join(publicDir, staged), bytes);
    const server = createServer((_req, res) => {
      res
        .writeHead(200, { 'content-type': 'application/octet-stream' })
        .end(bytes);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const html = section({
        binding: `${MERCHANT}/logo-a`,
        inner: `<picture><source srcSet="${origin}${staged} 96w" type="image/avif"/><img src="${origin}${staged}" alt="logo"/></picture>`,
        slot: 'header-logo',
      });
      const failures = await assertServedResponseBytes(html, {
        arm: 'pilot',
        origin,
        publicDir,
        timeoutMs: 2000,
      });
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(
        /served content-type "application\/octet-stream", expected "image\/avif"/
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('accepts hash-identical bytes served under the staged MIME type', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-mime-'));
    const staged = `/__pilot/${GEN}/${'f'.repeat(64)}.avif`;
    await mkdir(join(publicDir, '__pilot', GEN), { recursive: true });
    const bytes = Buffer.from('fake-avif-bytes');
    await writeFile(join(publicDir, staged), bytes);
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/avif' }).end(bytes);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const html = section({
        binding: `${MERCHANT}/logo-a`,
        inner: `<picture><source srcSet="${origin}${staged} 96w" type="image/avif"/><img src="${origin}${staged}" alt="logo"/></picture>`,
        slot: 'header-logo',
      });
      const failures = await assertServedResponseBytes(html, {
        arm: 'pilot',
        origin,
        publicDir,
        timeoutMs: 2000,
      });
      expect(failures).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
