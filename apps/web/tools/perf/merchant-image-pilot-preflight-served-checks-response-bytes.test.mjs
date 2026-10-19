import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { assertServedResponseBytes } from './merchant-image-pilot-preflight-served-checks.mjs';
import { sha256Hex } from './merchant-image-pilot-preflight-shared.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const GEN = 'c'.repeat(64);

function section({ binding, inner, slot, status }) {
  return `<section data-pilot-lab-binding="${binding}" data-pilot-lab-slot="${slot}"${
    status ? ` data-pilot-lab-status="${status}"` : ''
  }>${inner}</section>`;
}

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
        stagedHashes: { [staged]: sha256Hex(bytes) },
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

  it('rejects a swapped-in giant staged file on the byte ceiling', async () => {
    // A corrupted staged destination (huge regular file) must fail on
    // the staged ceiling instead of loading fully: the served-body cap
    // derives from the staged size, so an unbounded read here would
    // exhaust the preflight process before any comparison runs. No
    // server needed — the ceiling rejects before the fetch.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-served-giant-'));
    const staged = `/__pilot/${GEN}/${'f'.repeat(64)}.avif`;
    await mkdir(join(publicDir, '__pilot', GEN), { recursive: true });
    await writeFile(
      join(publicDir, staged),
      Buffer.alloc(MAX_INPUT_BYTES + 1, 7)
    );
    const html = section({
      binding: `${MERCHANT}/logo-a`,
      inner: `<img src="http://127.0.0.1:1${staged}" alt="logo"/>`,
      slot: 'header-logo',
    });
    const failures = await assertServedResponseBytes(html, {
      arm: 'pilot',
      origin: 'http://127.0.0.1:1',
      publicDir,
      stagedHashes: { [staged]: '0'.repeat(64) },
      timeoutMs: 2000,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/exceeds the .*10485760-byte staged ceiling/);
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
        stagedHashes: { [staged]: sha256Hex(bytes) },
        timeoutMs: 2000,
      });
      expect(failures).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
