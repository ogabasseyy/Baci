import './test-env.test-setup.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPortAvailable,
  createTlsCertificate,
  waitForHttps,
  writeCaddyfile,
} from './tls.mjs';

const dirs = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'chatwoot-tls-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  delete process.env.OPENSSL_BIN;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true })));
});

describe('chatwoot widget browser tls helpers', () => {
  it('assertPortAvailable resolves for a free port and rejects for a busy one', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await expect(assertPortAvailable('127.0.0.1', port)).rejects.toThrow();
    await new Promise((resolve) => server.close(resolve));
    await expect(
      assertPortAvailable('127.0.0.1', port)
    ).resolves.toBeUndefined();
  });

  it('writeCaddyfile proxies the platform origin with the given certificate', async () => {
    const dir = await tempDir();
    const caddyfilePath = join(dir, 'Caddyfile');
    await writeCaddyfile({
      caddyfilePath,
      certPath: '/c.pem',
      keyPath: '/k.pem',
    });
    const text = await readFile(caddyfilePath, 'utf8');
    expect(text).toContain('tls /c.pem /k.pem');
    expect(text).toContain('reverse_proxy 127.0.0.1:43119');
    expect(text).toContain('admin off');
  });

  it('waitForHttps rejects immediately when the proxy process already exited', async () => {
    await expect(
      waitForHttps('https://localhost:1/', { exitCode: 1 })
    ).rejects.toThrow('Local TLS proxy exited before becoming ready');
  });

  it('createTlsCertificate rejects when openssl cannot be started or fails', async () => {
    process.env.OPENSSL_BIN = '/nonexistent/openssl';
    const dir = await tempDir();
    await expect(
      createTlsCertificate({
        certPath: join(dir, 'c'),
        keyPath: join(dir, 'k'),
      })
    ).rejects.toThrow();
    process.env.OPENSSL_BIN = '/usr/bin/false';
    await expect(
      createTlsCertificate({
        certPath: join(dir, 'c'),
        keyPath: join(dir, 'k'),
      })
    ).rejects.toThrow('Could not create temporary TLS certificate');
  });
});
